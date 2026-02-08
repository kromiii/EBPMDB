import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import Database from 'better-sqlite3'
import { DocumentInfo, DocumentMeta } from '../interfaces/document'

const resolveDocsDir = () => {
  const candidates = [
    path.join(process.cwd(), 'docs'),
    path.join(process.cwd(), '..', 'docs'),
    path.join(__dirname, 'docs'),
    path.join(__dirname, '..', 'docs'),
    path.join(__dirname, '..', '..', 'docs'),
    path.join(__dirname, '..', '..', '..', 'docs'),
  ]

  const hit = candidates.find(p => fs.existsSync(p))
  if (!hit) {
    throw new Error('docs directory not found')
  }
  return hit
}

const DOCS_DIR = resolveDocsDir()
const DB_PATH = path.join(path.dirname(DOCS_DIR), 'data', 'documents.sqlite')

let db: Database.Database | null = null

const createTableSQL = `
CREATE TABLE IF NOT EXISTS documents (
  slug TEXT PRIMARY KEY,
  id TEXT,
  title TEXT,
  description TEXT,
  date TEXT,
  category TEXT,
  categoryLabel TEXT,
  points TEXT,
  contacts TEXT,
  tables TEXT,
  content TEXT,
  sort INTEGER
);
`

const ensureDatabase = () => {
  if (db) return db

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.exec(createTableSQL)

  seedFromMarkdown()

  return db
}

const ensureSeeded = () => {
  if (!db) return
  const row = db
    .prepare('SELECT COUNT(1) as count FROM documents')
    .get() as { count: number }
  if (row.count === 0) {
    seedFromMarkdown()
  }
}

const seedFromMarkdown = () => {
  if (!db) return
  db.exec('DELETE FROM documents')
  const files = fs.readdirSync(DOCS_DIR).filter(file => file.endsWith('.md'))
  const insert = db.prepare(`
    INSERT OR REPLACE INTO documents
    (slug, id, title, description, date, category, categoryLabel, points, contacts, tables, content, sort)
    VALUES (@slug, @id, @title, @description, @date, @category, @categoryLabel, @points, @contacts, @tables, @content, @sort)
  `)

  const tx = db.transaction((records: any[]) => {
    for (const record of records) insert.run(record)
  })

  const docs = files.map(file => {
    const slug = file.replace(/\.md$/, '')
    const raw = fs.readFileSync(path.join(DOCS_DIR, file)).toString()
    const parsed = matter(raw)
    const meta = parsed.data as Partial<DocumentMeta>
    const sort = getSortValue(slug, meta.id)

    return {
      slug,
      id: meta.id ?? '',
      title: meta.title ?? '',
      description: meta.description ?? '',
      date: meta.date ?? '',
      category: meta.category ?? '',
      categoryLabel: meta.categoryLabel ?? '',
      points: JSON.stringify(meta.points ?? []),
      contacts: JSON.stringify(meta.contacts ?? []),
      tables: JSON.stringify(meta.tables ?? []),
      content: parsed.content,
      sort,
    }
  })

  tx(docs)
}

const getSortValue = (slug: string, id?: string) => {
  const numericFromId = id ? parseInt(`${id}`.replace(/\D/g, ''), 10) : NaN
  if (!Number.isNaN(numericFromId)) return numericFromId

  const fromSlug = parseInt(slug.replace(/\D/g, ''), 10)
  return Number.isNaN(fromSlug) ? 0 : fromSlug
}

const parseJSON = <T>(value: string | null | undefined): T => {
  if (!value) return [] as unknown as T
  try {
    return JSON.parse(value) as T
  } catch {
    return [] as unknown as T
  }
}

const getAllDocuments = (): DocumentMeta[] => {
  const database = ensureDatabase()
  ensureSeeded()
  const rows = database
    .prepare(
      `SELECT slug, id, title, description, date, category, categoryLabel, points, contacts, tables
       FROM documents
       ORDER BY sort DESC, slug DESC`
    )
    .all() as {
      slug: string
      id?: string
      title: string
      description: string
      date: string
      category: string
      categoryLabel: string
      points: string
      contacts: string
      tables: string
    }[]

  return rows.map(row => ({
    slug: row.slug,
    id: row.id ?? '',
    title: row.title,
    description: row.description,
    date: row.date,
    category: row.category,
    categoryLabel: row.categoryLabel,
    points: parseJSON<string[]>(row.points),
    contacts: parseJSON<string[]>(row.contacts),
    tables: parseJSON(row.tables),
  }))
}

const getDocumentBySlug = (slug: string): DocumentInfo => {
  const database = ensureDatabase()
  ensureSeeded()
  const row = database
    .prepare(
      `SELECT slug, id, title, description, date, category, categoryLabel, points, contacts, tables, content
       FROM documents
       WHERE slug = ?`
    )
    .get(slug) as {
      slug: string
      id?: string
      title: string
      description: string
      date: string
      category: string
      categoryLabel: string
      points: string
      contacts: string
      tables: string
      content: string
    }

  if (!row) {
    throw new Error(`Document not found for slug: ${slug}`)
  }

  const meta: DocumentMeta = {
    slug: row.slug,
    id: row.id ?? '',
    title: row.title,
    description: row.description,
    date: row.date,
    category: row.category,
    categoryLabel: row.categoryLabel,
    points: parseJSON<string[]>(row.points),
    contacts: parseJSON<string[]>(row.contacts),
    tables: parseJSON(row.tables),
  }

  return { meta, content: row.content }
}

const getAllSlugs = () => {
  const database = ensureDatabase()
  ensureSeeded()
  const rows = database.prepare('SELECT slug FROM documents').all() as {
    slug: string
  }[]
  return rows.map(r => r.slug)
}

export { getAllDocuments, getDocumentBySlug, getAllSlugs }
