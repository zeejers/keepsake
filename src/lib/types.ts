export interface GroupNode {
  id: string
  name: string
  depth: number
  entryCount: number
  children: GroupNode[]
}

export interface EntryVM {
  id: string
  groupId: string
  title: string
  username: string
  url: string
}

export interface CustomField {
  key: string
  value: string
  protected: boolean
}

export interface AttachmentVM {
  name: string
  size: number
}

export interface EntryDetailVM extends EntryVM {
  password: string
  notes: string
  custom: CustomField[]
  attachments: AttachmentVM[]
  created: Date | undefined
  modified: Date | undefined
}

export interface EntryPatch {
  title: string
  username: string
  password: string
  url: string
  notes: string
  custom: CustomField[]
}

export interface SearchItem {
  kind: 'entry' | 'group'
  id: string
  title: string
  subtitle: string
  path: string
  notes: string
  url: string
}
