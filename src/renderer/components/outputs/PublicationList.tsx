import { List } from 'lucide-react'
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
          <h2 id="publication-list-title">成果索引</h2>
          <span>{papers.length} 篇</span>
        </div>
        <p>按论文快速查找</p>
      </header>
      <div className="publication-table" role="table" aria-label="科研成果列表">
        <div className="publication-table-header" role="row">
          <span role="columnheader">序号</span>
          <span role="columnheader">论文名称</span>
          <span role="columnheader">期刊等级</span>
          <span role="columnheader">发表年份</span>
        </div>
        <div className="publication-table-body">
          {papers.map((paper, index) => (
            <article
              className="publication-table-row"
              role="row"
              key={paper.id}
              data-testid="publication-list-row"
            >
              <span className="publication-list-index" role="cell">{String(index + 1).padStart(2, '0')}</span>
              <div className="publication-list-title" role="cell">
                <i
                  className={`publication-list-dot book-tone-${tone(paper.id)}`}
                  aria-hidden="true"
                />
                <button
                  title={paper.title}
                  onClick={() => paper.sourcePath ? useLibrary.getState().openPaper(paper.id) : edit(paper.id)}
                >
                  {paper.title}
                </button>
              </div>
              <span className="publication-list-grade" role="cell">
                {[paper.casPartition, paper.jcrQuartile].filter(Boolean).join(' · ') || '—'}
              </span>
              <time role="cell" dateTime={paper.publishedDate || paper.year}>
                {paper.publishedDate.slice(0, 4) || paper.year || '—'}
              </time>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
