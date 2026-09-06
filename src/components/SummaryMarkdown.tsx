import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Default export + its own module so VotingRecord can `lazy()` it -- this
// pulls react-markdown / remark-gfm (~46 KB gzip) into a separate chunk
// that only loads once someone actually generates a summary.

// Scoped element styling for the dark AI card: bold -> white, links ->
// blue + new tab, ordered/unordered lists get markers + padding.
const proseClass =
  'space-y-2 text-sm leading-relaxed text-blue-50 [&_a]:text-blue-300 [&_a]:underline [&_a]:decoration-blue-300/40 [&_a]:underline-offset-2 [&_h1]:font-semibold [&_h1]:text-white [&_h2]:font-semibold [&_h2]:text-white [&_h3]:font-semibold [&_h3]:text-white [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5'

export default function SummaryMarkdown({ children }: { children: string }) {
  return (
    <div className={proseClass}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
