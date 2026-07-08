import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as kdbxweb from 'kdbxweb'
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'
import {
  openVault,
  createVault,
  closeVault,
  saveVault,
  getDb,
  findBySource,
  friendlyOpenError,
  sourceId,
  sourceLabel,
  type VaultSource,
} from '../lib/kdbx'
import { DropboxConflictError } from '../lib/dropbox'
import type {
  AttachmentVM,
  CustomField,
  EntryDetailVM,
  EntryPatch,
  EntryVM,
  GroupNode,
  SearchItem,
} from '../lib/types'

const STANDARD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes'])
const CLIPBOARD_CLEAR_MS = 45_000
const RECENT_FILES_KEY = 'keepsake:recentFiles'
const MAX_RECENT = 5

export interface VaultSession {
  id: string
  path: string
  fileName: string
  dirty: boolean
  selectedGroupId: string | null
  /** primary selection — drives the detail pane */
  selectedEntryId: string | null
  /** full multi-selection (always contains selectedEntryId when non-empty) */
  selectedEntryIds: Set<string>
  /** shift-click range anchor */
  selectionAnchor: string | null
  editing: boolean
  editingIsNew: boolean
  expanded: Set<string>
}

// kdbxweb objects live outside Vue reactivity (Maps + ProtectedValues don't
// play well with deep proxies). The store exposes plain view-models derived
// from these maps — rebuilt for the ACTIVE vault whenever `tree` re-evaluates.
let groupMap = new Map<string, kdbxweb.KdbxGroup>()
let entryMap = new Map<string, kdbxweb.KdbxEntry>()
let clipboardTimer: ReturnType<typeof setTimeout> | null = null

function fieldText(entry: kdbxweb.KdbxEntry, name: string): string {
  const value = entry.fields.get(name)
  if (value === undefined) return ''
  return typeof value === 'string' ? value : value.getText()
}

function binaryBytes(
  binary: kdbxweb.KdbxBinary | kdbxweb.KdbxBinaryWithHash,
): Uint8Array {
  const value = kdbxweb.KdbxBinaries.isKdbxBinaryWithHash(binary) ? binary.value : binary
  if (value instanceof kdbxweb.ProtectedValue) return value.getBinary()
  return new Uint8Array(value)
}

function binarySize(binary: kdbxweb.KdbxBinary | kdbxweb.KdbxBinaryWithHash): number {
  const value = kdbxweb.KdbxBinaries.isKdbxBinaryWithHash(binary) ? binary.value : binary
  if (value instanceof kdbxweb.ProtectedValue) return value.byteLength
  return value.byteLength
}

function attachmentsOf(entry: kdbxweb.KdbxEntry): AttachmentVM[] {
  const out: AttachmentVM[] = []
  for (const [name, binary] of entry.binaries) {
    out.push({ name, size: binarySize(binary) })
  }
  return out
}

function entryToVM(entry: kdbxweb.KdbxEntry): EntryVM {
  return {
    id: entry.uuid.id,
    groupId: entry.parentGroup?.uuid.id ?? '',
    title: fieldText(entry, 'Title'),
    username: fieldText(entry, 'UserName'),
    url: fieldText(entry, 'URL'),
  }
}

function collectEntriesDeep(group: kdbxweb.KdbxGroup, out: kdbxweb.KdbxEntry[] = []) {
  for (const e of group.entries) out.push(e)
  for (const g of group.groups) collectEntriesDeep(g, out)
  return out
}

function groupPathOf(group: kdbxweb.KdbxGroup | undefined): string {
  const parts: string[] = []
  let g = group
  while (g && g.parentGroup) {
    parts.unshift(g.name ?? '')
    g = g.parentGroup
  }
  return parts.join(' / ')
}

export const useVaultStore = defineStore('vault', () => {
  // ---- state ----
  const sessions = ref<VaultSession[]>([])
  const activeId = ref<string | null>(null)
  const revision = ref(0)
  const saving = ref(false)

  const searchOpen = ref(false)
  const helpOpen = ref(false)

  const toast = ref<{ id: number; message: string } | null>(null)
  let toastCounter = 0
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  // ---- session accessors ----
  const active = computed<VaultSession | null>(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null,
  )
  const locked = computed(() => sessions.value.length === 0)

  const fileName = computed(() => active.value?.fileName ?? '')
  const dirty = computed(() => active.value?.dirty ?? false)
  const anyDirty = computed(() => sessions.value.some((s) => s.dirty))
  const selectedGroupId = computed(() => active.value?.selectedGroupId ?? null)
  const selectedEntryId = computed(() => active.value?.selectedEntryId ?? null)
  const selectedEntryIds = computed(() => active.value?.selectedEntryIds ?? new Set<string>())
  const editing = computed(() => active.value?.editing ?? false)
  const editingIsNew = computed(() => active.value?.editingIsNew ?? false)
  const expandedGroups = computed(() => active.value?.expanded ?? new Set<string>())

  // ---- derived (active vault) ----
  const recycleBinId = computed<string | null>(() => {
    revision.value
    if (!active.value) return null
    const db = getDb(active.value.id)
    if (!db.meta.recycleBinEnabled || !db.meta.recycleBinUuid) return null
    return db.meta.recycleBinUuid.id
  })

  const tree = computed<GroupNode[]>(() => {
    revision.value
    if (!active.value) return []
    groupMap = new Map()
    entryMap = new Map()
    const db = getDb(active.value.id)
    const root = db.getDefaultGroup()
    const binId = recycleBinId.value

    const build = (g: kdbxweb.KdbxGroup, depth: number): GroupNode => {
      groupMap.set(g.uuid.id, g)
      for (const e of g.entries) entryMap.set(e.uuid.id, e)
      return {
        id: g.uuid.id,
        name: g.name ?? '',
        depth,
        entryCount: g.entries.length,
        children: g.groups
          .filter((c) => c.uuid.id !== binId)
          .map((c) => build(c, depth + 1)),
      }
    }

    const rootNode = build(root, -1)
    // Index the recycle bin subtree too (excluded from the main tree, shown as Trash)
    if (binId) {
      const bin = root.groups.find((g) => g.uuid.id === binId)
      if (bin) build(bin, 0)
    }

    const top = [...rootNode.children]
    // Databases can hold entries directly in the root group; surface it if so.
    if (root.entries.length > 0) {
      top.unshift({ ...rootNode, depth: 0, children: [] })
    }
    return top
  })

  const rootGroupId = computed<string | null>(() => {
    revision.value
    if (!active.value) return null
    return getDb(active.value.id).getDefaultGroup().uuid.id
  })

  /** groupMap/entryMap are rebuilt as a side effect of evaluating `tree`;
   *  every computed that reads the maps must touch tree.value first. */
  function ensureMaps() {
    void tree.value
  }

  const trashCount = computed(() => {
    ensureMaps()
    const binId = recycleBinId.value
    if (!binId) return 0
    const bin = groupMap.get(binId)
    return bin ? collectEntriesDeep(bin).length : 0
  })

  const inTrash = computed(
    () => selectedGroupId.value !== null && selectedGroupId.value === recycleBinId.value,
  )

  const selectedGroupName = computed(() => {
    ensureMaps()
    if (!selectedGroupId.value) return ''
    if (inTrash.value) return 'Trash'
    return groupMap.get(selectedGroupId.value)?.name ?? ''
  })

  const entries = computed<EntryVM[]>(() => {
    if (locked.value || !selectedGroupId.value) return []
    ensureMaps()
    const group = groupMap.get(selectedGroupId.value)
    if (!group) return []
    const raw = inTrash.value ? collectEntriesDeep(group) : [...group.entries]
    return raw
      .map(entryToVM)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  })

  const selectedEntry = computed<EntryDetailVM | null>(() => {
    if (locked.value || !selectedEntryId.value) return null
    ensureMaps()
    const entry = entryMap.get(selectedEntryId.value)
    if (!entry) return null
    const custom: CustomField[] = []
    for (const [key, value] of entry.fields) {
      if (STANDARD_FIELDS.has(key)) continue
      custom.push({
        key,
        value: typeof value === 'string' ? value : value.getText(),
        protected: typeof value !== 'string',
      })
    }
    return {
      ...entryToVM(entry),
      password: fieldText(entry, 'Password'),
      notes: fieldText(entry, 'Notes'),
      custom,
      attachments: attachmentsOf(entry),
      created: entry.times.creationTime,
      modified: entry.times.lastModTime,
    }
  })

  const searchItems = computed<SearchItem[]>(() => {
    if (locked.value) return []
    ensureMaps()
    const binId = recycleBinId.value
    const inBin = (g: kdbxweb.KdbxGroup | undefined): boolean => {
      let p = g
      while (p) {
        if (p.uuid.id === binId) return true
        p = p.parentGroup
      }
      return false
    }
    const items: SearchItem[] = []
    for (const [id, group] of groupMap) {
      if (id === binId || id === rootGroupId.value || inBin(group)) continue
      items.push({
        kind: 'group',
        id,
        title: group.name ?? '',
        subtitle: `${group.entries.length} entries`,
        path: groupPathOf(group.parentGroup ?? undefined),
        notes: '',
        url: '',
      })
    }
    for (const [id, entry] of entryMap) {
      if (inBin(entry.parentGroup)) continue
      items.push({
        kind: 'entry',
        id,
        title: fieldText(entry, 'Title') || '(untitled)',
        subtitle: fieldText(entry, 'UserName'),
        path: groupPathOf(entry.parentGroup),
        notes: fieldText(entry, 'Notes'),
        url: fieldText(entry, 'URL'),
      })
    }
    return items
  })

  // ---- helpers ----
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

  /** Every mutation marks the vault dirty and auto-saves to disk shortly after. */
  function touch() {
    const session = active.value
    if (session) {
      session.dirty = true
      const sid = session.id
      if (autoSaveTimer) clearTimeout(autoSaveTimer)
      autoSaveTimer = setTimeout(() => void save(sid), 400)
    }
    revision.value++
  }

  function showToast(message: string) {
    toast.value = { id: ++toastCounter, message }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = null), 2400)
  }

  function recentFiles(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_FILES_KEY)
      const list = raw ? (JSON.parse(raw) as string[]) : []
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  function rememberRecent(path: string) {
    const list = [path, ...recentFiles().filter((p) => p !== path)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(list))
  }

  function initSession(id: string, source: VaultSource) {
    const session: VaultSession = {
      id,
      path: sourceId(source),
      fileName: sourceLabel(source),
      dirty: false,
      selectedGroupId: null,
      selectedEntryId: null,
      selectedEntryIds: new Set(),
      selectionAnchor: null,
      editing: false,
      editingIsNew: false,
      expanded: new Set(),
    }
    sessions.value.push(session)
    activeId.value = id
    revision.value++
    rememberRecent(sourceId(source))
    // default: select the first group, expand top level
    const current = sessions.value.find((s) => s.id === id)!
    current.selectedGroupId = tree.value[0]?.id ?? rootGroupId.value
    current.expanded = new Set(tree.value.map((n) => n.id))
  }

  // ---- vault lifecycle ----
  async function unlock(source: VaultSource, password: string, keyFilePath?: string | null) {
    const already = findBySource(source)
    if (already) {
      activeId.value = already
      return
    }
    let id: string
    try {
      id = await openVault(source, password, keyFilePath)
    } catch (err) {
      throw new Error(friendlyOpenError(err))
    }
    initSession(id, source)
  }

  async function createNew(source: VaultSource, password: string) {
    let id: string
    try {
      id = await createVault(source, password)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Could not create the database.')
    }
    initSession(id, source)
    showToast(`Created ${sourceLabel(source)}`)
  }

  function setActive(id: string) {
    if (sessions.value.some((s) => s.id === id)) {
      activeId.value = id
      revision.value++
    }
  }

  /** Close a vault session. Caller is responsible for the dirty-save prompt. */
  function closeSession(id: string) {
    const idx = sessions.value.findIndex((s) => s.id === id)
    if (idx < 0) return
    closeVault(id)
    sessions.value.splice(idx, 1)
    if (activeId.value === id) {
      const neighbor = sessions.value[Math.min(idx, sessions.value.length - 1)]
      activeId.value = neighbor?.id ?? null
    }
    revision.value++
  }

  let pendingSaveId: string | null = null

  async function save(id?: string) {
    const session = id ? sessions.value.find((s) => s.id === id) : active.value
    if (!session) return
    if (saving.value) {
      pendingSaveId = session.id
      return
    }
    saving.value = true
    // optimistic: mutations that land during the write re-set dirty via touch()
    session.dirty = false
    try {
      await saveVault(session.id)
      showToast('Saved')
    } catch (err) {
      if (err instanceof DropboxConflictError) {
        // our data IS persisted (as a conflict copy) — don't re-mark dirty
        showToast(`Dropbox file changed elsewhere — your version saved as "${err.renamedTo}"`)
        return
      }
      session.dirty = true
      showToast(err instanceof Error ? `Save failed: ${err.message}` : 'Save failed')
      throw err
    } finally {
      saving.value = false
      if (pendingSaveId) {
        const next = pendingSaveId
        pendingSaveId = null
        setTimeout(() => void save(next), 50)
      }
    }
  }

  /** Close every open vault, best-effort saving dirty ones first (auto-lock). */
  async function lockAll() {
    for (const s of [...sessions.value]) {
      if (s.dirty) {
        try {
          await save(s.id)
        } catch {
          // save() already toasted; locking still wins over staying open
        }
      }
      closeSession(s.id)
    }
  }

  // ---- selection & editing ----
  function setSelection(session: VaultSession, ids: string[], primary: string | null, anchor?: string | null) {
    session.selectedEntryIds = new Set(ids)
    session.selectedEntryId = primary
    session.selectionAnchor = anchor === undefined ? primary : anchor
    session.editing = false
  }

  /** Pass null to deselect all groups (e.g. before creating one at the root). */
  function selectGroup(id: string | null) {
    if (!active.value) return
    active.value.selectedGroupId = id
    setSelection(active.value, [], null)
  }

  function selectEntry(id: string | null) {
    if (!active.value) return
    setSelection(active.value, id ? [id] : [], id)
  }

  /** ⌘-click: toggle an entry in/out of the multi-selection. */
  function toggleEntrySelect(id: string) {
    const session = active.value
    if (!session) return
    const ids = new Set(session.selectedEntryIds)
    if (session.selectedEntryId && ids.size === 0) ids.add(session.selectedEntryId)
    if (ids.has(id)) {
      ids.delete(id)
      const primary =
        session.selectedEntryId === id ? ([...ids].pop() ?? null) : session.selectedEntryId
      setSelection(session, [...ids], primary, id)
    } else {
      ids.add(id)
      setSelection(session, [...ids], id, id)
    }
  }

  /** shift-click: select the range between the anchor and the clicked entry. */
  function rangeSelectEntries(id: string) {
    const session = active.value
    if (!session) return
    const list = entries.value.map((e) => e.id)
    const anchor = session.selectionAnchor ?? session.selectedEntryId ?? id
    const from = list.indexOf(anchor)
    const to = list.indexOf(id)
    if (from < 0 || to < 0) {
      setSelection(session, [id], id)
      return
    }
    const [lo, hi] = from < to ? [from, to] : [to, from]
    setSelection(session, list.slice(lo, hi + 1), id, anchor)
  }

  function selectAllEntries() {
    const session = active.value
    if (!session) return
    const list = entries.value.map((e) => e.id)
    if (!list.length) return
    setSelection(session, list, session.selectedEntryId ?? list[0]!, list[0])
  }

  /** Select an entry from anywhere (search): navigates to its group first. */
  function revealEntry(id: string) {
    if (!active.value) return
    ensureMaps()
    const entry = entryMap.get(id)
    if (!entry) return
    const gid = entry.parentGroup?.uuid.id
    if (gid) {
      active.value.selectedGroupId = gid
      let p = entry.parentGroup?.parentGroup
      while (p) {
        active.value.expanded.add(p.uuid.id)
        p = p.parentGroup
      }
    }
    setSelection(active.value, [id], id)
  }

  function moveEntrySelection(delta: number) {
    if (!active.value) return
    const list = entries.value
    if (!list.length) return
    const idx = list.findIndex((e) => e.id === active.value!.selectedEntryId)
    const next =
      idx < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(Math.max(idx + delta, 0), list.length - 1)
    setSelection(active.value, [list[next]!.id], list[next]!.id)
  }

  /** shift+arrow: grow the selection from the primary entry. */
  function extendEntrySelection(delta: number) {
    const session = active.value
    if (!session) return
    const list = entries.value.map((e) => e.id)
    if (!list.length) return
    const idx = list.indexOf(session.selectedEntryId ?? '')
    if (idx < 0) {
      moveEntrySelection(delta)
      return
    }
    const next = Math.min(Math.max(idx + delta, 0), list.length - 1)
    const ids = new Set(session.selectedEntryIds)
    ids.add(list[idx]!)
    ids.add(list[next]!)
    setSelection(session, [...ids], list[next]!, session.selectionAnchor ?? list[idx]!)
  }

  function startEdit() {
    const session = active.value
    if (!session || !selectedEntry.value) return
    // editing works on a single entry — collapse any multi-selection first
    setSelection(session, [selectedEntry.value.id], selectedEntry.value.id)
    session.editing = true
    session.editingIsNew = false
  }

  function cancelEdit() {
    const session = active.value
    if (!session) return
    if (session.editing && session.editingIsNew && session.selectedEntryId) {
      // never-saved entry: remove it outright rather than sending to trash
      ensureMaps()
      const entry = entryMap.get(session.selectedEntryId)
      const parent = entry?.parentGroup
      if (entry && parent) {
        const idx = parent.entries.indexOf(entry)
        if (idx >= 0) parent.entries.splice(idx, 1)
      }
      setSelection(session, [], null)
      revision.value++
    }
    session.editing = false
    session.editingIsNew = false
  }

  // ---- mutations ----
  function createEntry(groupId?: string) {
    const session = active.value
    if (!session) return
    ensureMaps()
    const db = getDb(session.id)
    let gid = groupId ?? session.selectedGroupId ?? rootGroupId.value
    if (!gid || gid === recycleBinId.value) gid = rootGroupId.value
    const group = (gid && groupMap.get(gid)) || db.getDefaultGroup()
    const entry = db.createEntry(group)
    entry.fields.set('Title', '')
    entry.fields.set('UserName', '')
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(''))
    entry.fields.set('URL', '')
    entry.fields.set('Notes', '')
    revision.value++
    session.selectedGroupId = group.uuid.id
    setSelection(session, [entry.uuid.id], entry.uuid.id)
    session.editing = true
    session.editingIsNew = true
  }

  function updateEntry(id: string, patch: EntryPatch) {
    const session = active.value
    if (!session) return
    ensureMaps()
    const entry = entryMap.get(id)
    if (!entry) return
    if (!session.editingIsNew) entry.pushHistory()
    entry.fields.set('Title', patch.title)
    entry.fields.set('UserName', patch.username)
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(patch.password))
    entry.fields.set('URL', patch.url)
    entry.fields.set('Notes', patch.notes)
    for (const key of [...entry.fields.keys()]) {
      if (!STANDARD_FIELDS.has(key)) entry.fields.delete(key)
    }
    for (const field of patch.custom) {
      const key = field.key.trim()
      if (!key) continue
      entry.fields.set(
        key,
        field.protected ? kdbxweb.ProtectedValue.fromString(field.value) : field.value,
      )
    }
    entry.times.lastModTime = new Date()
    entry.times.lastAccessTime = new Date()
    session.editing = false
    session.editingIsNew = false
    touch()
  }

  function deleteEntry(id: string) {
    deleteEntries([id])
  }

  function deleteEntries(ids: string[]) {
    const session = active.value
    if (!session || !ids.length) return
    ensureMaps()
    const wasInTrash = inTrash.value
    const db = getDb(session.id)
    let removed = 0
    for (const id of ids) {
      const entry = entryMap.get(id)
      if (!entry) continue
      db.remove(entry)
      removed++
    }
    if (!removed) return
    setSelection(session, [], null)
    touch()
    const what = removed === 1 ? 'Entry' : `${removed} entries`
    showToast(wasInTrash ? `${what} deleted permanently` : `${what} moved to trash`)
  }

  function deleteSelectedEntries() {
    const session = active.value
    if (!session) return
    const ids = session.selectedEntryIds.size
      ? [...session.selectedEntryIds]
      : session.selectedEntryId
        ? [session.selectedEntryId]
        : []
    deleteEntries(ids)
  }

  function createGroup(name: string, parentId?: string) {
    const session = active.value
    if (!session || !name.trim()) return
    ensureMaps()
    const db = getDb(session.id)
    let pid = parentId ?? session.selectedGroupId ?? rootGroupId.value
    if (!pid || pid === recycleBinId.value) pid = rootGroupId.value
    const parent = (pid && groupMap.get(pid)) || db.getDefaultGroup()
    const group = db.createGroup(parent, name.trim())
    touch()
    session.expanded.add(parent.uuid.id)
    session.selectedGroupId = group.uuid.id
    session.selectedEntryId = null
  }

  function renameGroup(id: string, name: string) {
    ensureMaps()
    const group = groupMap.get(id)
    if (!group || !name.trim()) return
    group.name = name.trim()
    touch()
  }

  function deleteGroup(id: string) {
    const session = active.value
    if (!session) return
    ensureMaps()
    const group = groupMap.get(id)
    if (!group || id === rootGroupId.value) return
    getDb(session.id).remove(group)
    if (session.selectedGroupId === id) {
      session.selectedGroupId = rootGroupId.value
      session.selectedEntryId = null
    }
    touch()
    showToast('Group moved to trash')
  }

  function emptyTrash() {
    const session = active.value
    if (!session) return
    ensureMaps()
    const binId = recycleBinId.value
    if (!binId) return
    const bin = groupMap.get(binId)
    if (!bin) return
    const db = getDb(session.id)
    for (const entry of [...bin.entries]) db.remove(entry)
    for (const group of [...bin.groups]) db.remove(group)
    session.selectedEntryId = null
    touch()
    showToast('Trash emptied')
  }

  function toggleGroupExpanded(id: string) {
    const session = active.value
    if (!session) return
    if (session.expanded.has(id)) session.expanded.delete(id)
    else session.expanded.add(id)
  }

  // ---- attachments ----
  async function addAttachment(entryId: string, name: string, data: Uint8Array) {
    const session = active.value
    if (!session) return
    ensureMaps()
    const entry = entryMap.get(entryId)
    if (!entry) return
    const db = getDb(session.id)
    const binary = await db.createBinary(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    )
    // avoid clobbering an existing attachment with the same name
    let finalName = name
    for (let n = 2; entry.binaries.has(finalName); n++) {
      const dot = name.lastIndexOf('.')
      finalName = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
    }
    entry.binaries.set(finalName, binary)
    entry.times.lastModTime = new Date()
    touch()
    showToast(`Attached ${finalName}`)
  }

  function removeAttachment(entryId: string, name: string) {
    const session = active.value
    if (!session) return
    ensureMaps()
    const entry = entryMap.get(entryId)
    if (!entry || !entry.binaries.has(name)) return
    entry.binaries.delete(name)
    entry.times.lastModTime = new Date()
    touch()
    showToast(`Removed ${name}`)
  }

  function getAttachmentBytes(entryId: string, name: string): Uint8Array | null {
    ensureMaps()
    const binary = entryMap.get(entryId)?.binaries.get(name)
    return binary ? binaryBytes(binary) : null
  }

  // ---- clipboard ----
  async function copyToClipboard(text: string, label: string) {
    if (!text) {
      showToast(`Nothing to copy — ${label.toLowerCase()} is empty`)
      return
    }
    await writeText(text)
    showToast(`${label} copied · clears in 45s`)
    if (clipboardTimer) clearTimeout(clipboardTimer)
    clipboardTimer = setTimeout(async () => {
      try {
        const current = await readText()
        if (current === text) await writeText('')
      } catch {
        // clipboard read can fail (e.g. non-text content); nothing to clear then
      }
    }, CLIPBOARD_CLEAR_MS)
  }

  function copyPassword(id?: string) {
    ensureMaps()
    const entry = entryMap.get(id ?? selectedEntryId.value ?? '')
    if (!entry) return
    void copyToClipboard(fieldText(entry, 'Password'), 'Password')
  }

  function copyUsername(id?: string) {
    ensureMaps()
    const entry = entryMap.get(id ?? selectedEntryId.value ?? '')
    if (!entry) return
    void copyToClipboard(fieldText(entry, 'UserName'), 'Username')
  }

  return {
    // state
    sessions,
    activeId,
    locked,
    fileName,
    dirty,
    anyDirty,
    saving,
    revision,
    selectedGroupId,
    selectedEntryId,
    selectedEntryIds,
    editing,
    editingIsNew,
    searchOpen,
    helpOpen,
    expandedGroups,
    toast,
    // derived
    tree,
    rootGroupId,
    recycleBinId,
    trashCount,
    inTrash,
    selectedGroupName,
    entries,
    selectedEntry,
    searchItems,
    // actions
    unlock,
    createNew,
    setActive,
    closeSession,
    lockAll,
    save,
    selectGroup,
    selectEntry,
    toggleEntrySelect,
    rangeSelectEntries,
    selectAllEntries,
    revealEntry,
    moveEntrySelection,
    extendEntrySelection,
    startEdit,
    cancelEdit,
    createEntry,
    updateEntry,
    deleteEntry,
    deleteEntries,
    deleteSelectedEntries,
    createGroup,
    renameGroup,
    deleteGroup,
    emptyTrash,
    toggleGroupExpanded,
    addAttachment,
    removeAttachment,
    getAttachmentBytes,
    copyToClipboard,
    copyPassword,
    copyUsername,
    showToast,
    recentFiles,
  }
})
