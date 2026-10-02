// Per-route <title> and description. React 19 hoists these into <head> and
// removes them when the route unmounts, so each page just renders one.
// index.html keeps its own static title/description for crawlers and link
// unfurlers that don't run JS.
export default function PageMeta({ title, description, noindex = false }) {
  return (
    <>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      {noindex && <meta name="robots" content="noindex" />}
    </>
  )
}
