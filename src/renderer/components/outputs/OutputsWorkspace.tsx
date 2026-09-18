import { useState } from 'react'
import { Library, FileText, Plus, Search } from 'lucide-react'
import { useLibrary } from '../../stores/library'
import { Button } from '../ui/button'
import { PdfReader } from '../literature/PdfReader'
import { PublicationDialog } from './PublicationDialog'
import { TranslationQueue } from '../literature/TranslationQueue'
import { PublicationBookcase } from './PublicationBookcase'
import { PublicationList } from './PublicationList'

export function OutputsWorkspace() {
  const { papers, outputYear, outputJournal, filterOutputs, loaded, loadError } = useLibrary()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const publications = papers.filter((p) => p.collection === 'publication')
  const filtered = publications
    .filter(
      (p) =>
        (outputYear === 'all' || p.publishedDate.startsWith(outputYear)) &&
        (outputJournal === 'all' || p.journal === outputJournal) &&
        `${p.title} ${p.authors} ${p.journal} ${p.doi}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : b.publishedDate.localeCompare(a.publishedDate) || b.addedAt.localeCompare(a.addedAt)
    )
  const journalCount = new Set(publications.map((p) => p.journal)).size
  const selected = papers.find((p) => p.id === editing)
  return (
    <main className="literature-workspace outputs-workspace">
      <header className="workspace-header library-header">
        <div>
          <div className="workspace-breadcrumb">
            科研成果<span>/</span>
            {outputYear === 'all' ? '我的发表' : `${outputYear} 年`}
          </div>
          <div className="heading-line">
            <h1>科研成果</h1>
            <span className="library-count">{publications.length} 篇</span>
          </div>
          <p>把每一段完成的研究，收入自己的书架。</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={17} />
          添加成果
        </Button>
      </header>
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={17} />
          <input
            aria-label="搜索科研成果"
            placeholder="搜索标题、作者、期刊或 DOI"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="科研成果排序" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">发表时间由近到远</option>
          <option value="title">标题排序</option>
        </select>
      </div>
      <TranslationQueue papers={publications} />
      <div className="library-scroll">
        <section className="bookcase-heading">
          <div>
            <Library size={18} strokeWidth={1.5} />
            <strong>我的学术藏书</strong>
            <span>{journalCount} 种期刊 / 会议</span>
          </div>
          <p>点击书脊，抽出一篇论文</p>
        </section>
        {(outputYear !== 'all' || outputJournal !== 'all') && (
          <div className="output-filter-summary">
            <span>
              {[
                outputYear !== 'all' && `${outputYear} 年`,
                outputJournal !== 'all' && outputJournal
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              · {filtered.length} 篇
            </span>
            <button onClick={() => filterOutputs('all', 'all')}>清除筛选</button>
          </div>
        )}
        {loadError ? (
          <div className="empty-state">
            <p role="alert">{loadError}</p>
            <Button onClick={() => void useLibrary.getState().load()}>重试</Button>
          </div>
        ) : !loaded ? (
          <div className="empty-state">正在读取科研成果…</div>
        ) : filtered.length ? (
          <>
            <PublicationBookcase papers={filtered} edit={setEditing} />
            <PublicationList papers={filtered} edit={setEditing} />
          </>
        ) : (
          <div className="library-empty">
            <div className="empty-paper-stack">
              <FileText size={46} strokeWidth={1} />
            </div>
            <h2>{publications.length ? '没有符合条件的成果' : '让发表的成果，有自己的位置'}</h2>
            <p>
              {publications.length
                ? '调整左侧年份、期刊或搜索条件。'
                : '上传论文 PDF，自动识别文章资料，核对后保存。'}
            </p>
            {publications.length ? (
              <Button
                onClick={() => {
                  filterOutputs('all', 'all')
                  setQuery('')
                }}
              >
                清除筛选
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Plus size={16} />
                添加第一项成果
              </Button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <PublicationDialog key={editing} paper={selected} onClose={() => setEditing(null)} />
      )}
      <PdfReader />
    </main>
  )
}
