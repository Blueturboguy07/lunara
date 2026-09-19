import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ARTICLES } from '../content/articles'
import { db, getSetting, SK, type Goal } from '../db/schema'
import { isAdultBirthYear } from '../lib/publikApi'
import { useApp } from '../state/appStore'

const GOAL_CATEGORY: Record<Goal, string> = {
  cycle: 'Cycle basics',
  ttc: 'Fertility',
  pregnancy: 'Pregnancy',
  peri: 'Perimenopause',
}

const CATEGORY_TONE: Record<string, string> = {
  'Cycle basics': 'rose',
  Symptoms: 'clay',
  Fertility: 'teal',
  Perimenopause: 'sun',
  Pregnancy: 'yellow',
  Privacy: 'mineral',
}

export function Insights() {
  const { setArticleSlug, setAssistantOpen } = useApp()
  const [query, setQuery] = useState('')
  const data = useLiveQuery(async () => {
    const [goal, bookmarks, birthYear] = await Promise.all([
      getSetting(SK.goal),
      db.contentBookmarks.toArray(),
      getSetting(SK.birthYear),
    ])
    return {
      goal: (goal ?? 'cycle') as Goal,
      saved: new Set(bookmarks.map((bookmark) => bookmark.slug)),
      // The AI companion is adults-only everywhere, not just in onboarding.
      adult: isAdultBirthYear(birthYear),
    }
  }, [])

  const featured = data ? GOAL_CATEGORY[data.goal] : 'Cycle basics'
  const categories = [...new Set(ARTICLES.map((article) => article.category))].sort((a, b) =>
    a === featured ? -1 : b === featured ? 1 : 0,
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searchResults = normalizedQuery
    ? ARTICLES.filter((article) =>
        [article.title, article.category, ...article.body]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : []

  return (
    <div className="page insights-page">
      <header className="page-title-block">
        <span className="page-kicker">Knowledge for your season</span>
        <h1>Read, ask, notice</h1>
        <p>Calm explanations for the questions that rarely fit into a search bar.</p>
      </header>

      {data?.adult && (
      <button className="assistant-feature" onClick={() => setAssistantOpen(true)}>
        <span className="assistant-constellation" aria-hidden="true">
          <i className="constellation-orbit orbit-a" />
          <i className="constellation-orbit orbit-b" />
          <i className="constellation-seed seed-a" />
          <i className="constellation-seed seed-b" />
          <i className="constellation-seed seed-c" />
        </span>
        <span className="assistant-feature-copy">
          <span className="assistant-feature-kicker">Lunara AI</span>
          <strong>Bring the question you keep circling</strong>
          <small>Your key, your conversation, your choice</small>
        </span>
        <span className="assistant-feature-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12h13M13 7l5 5-5 5" />
          </svg>
        </span>
      </button>
      )}

      <div className="insights-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.4 15.4 4.1 4.1" />
        </svg>
        <input
          type="search"
          aria-label="Search articles"
          placeholder="Search cycles, symptoms, fertility…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && <button onClick={() => setQuery('')} aria-label="Clear article search">×</button>}
      </div>

      {normalizedQuery ? (
        <section className="insight-section search-results" aria-live="polite">
          <div className="section-heading insight-section-heading">
            <div>
              <span className="section-overline">Library search</span>
              <h2>{searchResults.length ? `Results for “${query.trim()}”` : 'Nothing matched yet'}</h2>
            </div>
            <span className="collection-count">{searchResults.length}</span>
          </div>
          {searchResults.length ? (
            <div className="article-list">
              {searchResults.map((article, index) => (
                <button
                  key={article.slug}
                  className="article-card"
                  onClick={() => setArticleSlug(article.slug)}
                >
                  <span className="article-visual" aria-hidden="true">
                    <i className="article-orbit" />
                    <i className="article-leaf leaf-one" />
                    <i className="article-leaf leaf-two" />
                    <b>{String(index + 1).padStart(2, '0')}</b>
                  </span>
                  <span className="article-copy">
                    <span className="article-meta">{article.category} · {article.minutes} min read</span>
                    <strong>{article.title}</strong>
                    <span className="article-open" aria-hidden="true">Read <b>↗</b></span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="card empty-card">
              Try a broader word, or ask Lunara AI without sharing tracker data.
            </div>
          )}
        </section>
      ) : (
        <>
          <nav className="category-ribbon" aria-label="Insight categories">
            {categories.map((category) => (
              <a key={category} href={`#category-${category.toLowerCase().replaceAll(' ', '-')}`}>
                {category}
              </a>
            ))}
          </nav>
          <div className="insight-sections">
            {categories.map((category, categoryIndex) => {
          const articles = ARTICLES.filter((article) => article.category === category)
          const tone = CATEGORY_TONE[category] ?? 'rose'
          return (
            <section
              key={category}
              className={`insight-section tone-${tone}`}
              id={`category-${category.toLowerCase().replaceAll(' ', '-')}`}
            >
              <div className="section-heading insight-section-heading">
                <div>
                  <span className="section-overline">
                    {categoryIndex === 0 ? 'Chosen for your focus' : `Collection 0${categoryIndex + 1}`}
                  </span>
                  <h2>{category}</h2>
                </div>
                <span className="collection-count">{articles.length}</span>
              </div>

              <div className="article-list">
                {articles.map((article, index) => (
                  <button
                    key={article.slug}
                    className={`article-card${categoryIndex === 0 && index === 0 ? ' article-featured' : ''}`}
                    onClick={() => setArticleSlug(article.slug)}
                  >
                    <span className="article-visual" aria-hidden="true">
                      <i className="article-orbit" />
                      <i className="article-leaf leaf-one" />
                      <i className="article-leaf leaf-two" />
                      <b>{String(index + 1).padStart(2, '0')}</b>
                    </span>
                    <span className="article-copy">
                      <span className="article-meta">
                        {article.minutes} min read
                        {data?.saved.has(article.slug) && (
                          <span className="saved-label">
                            <span aria-hidden="true">◆</span> Saved
                          </span>
                        )}
                      </span>
                      <strong>{article.title}</strong>
                      <span className="article-open" aria-hidden="true">Read <b>↗</b></span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )
            })}
          </div>
        </>
      )}
    </div>
  )
}
