import { BookOpen, List, Pencil } from 'lucide-react'
import type { Paper } from '../../../shared/types'
import { useLibrary } from '../../stores/library'

function tone(id: string) {
  let value = 0
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value % 8
}

export function PublicationList({ papers, edit }: { papers: Paper[]; edit: (id: string) => void }) {
  return (
    <section className="publication-list" aria-labelledby="publication-list-title">
      <header className="publication-list-heading">
        <div>
          <List size={17} strokeWidth={1.6} />
          <h2 id="publication-list-title">成果列表</h2>
          <span>{papers.length} 篇</span>
        </div>
        <p>书架的紧凑索引</p>
      </header>
      <div className="publication-table" role="table" aria-label="科研成果列表">
        <div className="publication-table-header" role="row">
          <span role="columnheader">标题</span>
          <span role="columnheader">作者</span>
          <span role="columnheader">发表时间</span>
          <span role="columnheader">期刊 / 会议</span>
          <span role="columnheader">分区</span>
          <span role="columnheader">操作</span>
        </div>
        <div className="publication-table-body">
          {papers.map((paper) => (
            <article
              className="publication-table-row"
              role="row"
              key={paper.id}
              data-testid="publication-list-row"
            >
              <div className="publication-list-title" role="cell">
                <i
                  className={`publication-list-dot book-tone-${tone(paper.id)}`}
                  aria-hidden="true"
                />
                <button
                  title={paper.title}
                  onClick={() => useLibrary.getState().openPaper(paper.id)}
                >
                  {paper.title}
                </button>
              </div>
              <span className="publication-list-authors" role="cell" title={paper.authors}>
                {paper.authors || '暂未填写'}
              </span>
              <time role="cell" dateTime={paper.publishedDate}>
                {paper.publishedDate || paper.year || '—'}
              </time>
              <span className="publication-list-journal" role="cell" title={paper.journal}>
                {paper.journal || '暂未填写'}
              </span>
              <span className="publication-list-partition" role="cell">
                {paper.casPartition || paper.jcrQuartile || '—'}
              </span>
              <div className="publication-list-actions" role="cell">
                <button
                  aria-label={`阅读 ${paper.title}`}
                  title="阅读论文"
                  onClick={() => useLibrary.getState().openPaper(paper.id)}
                >
                  <BookOpen size={14} />
                </button>
                <button
                  aria-label={`编辑 ${paper.title}`}
                  title="编辑成果"
                  onClick={() => edit(paper.id)}
                >
                  <Pencil size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
