import { useId, useState } from 'react'

// Buttondown's own embed form, posted straight to Buttondown — no API key and
// nothing stored here. target="_blank" opens Buttondown's confirmation page in
// a new tab so the visitor stays on the site.
// Ids come from useId so the label and heading stay unique on the page.
export default function NewsletterSignup({ heading = 'New hikes in your inbox' }) {
  const id = useId()
  const inputId = `bd-email-${id}`
  const headingId = `newsletter-heading-${id}`
  const [sent, setSent] = useState(false)

  // The page doesn't reload (Buttondown opens in a new tab), so the email
  // would otherwise sit in the box. Clear it on the next tick: the browser
  // reads the field after this handler runs, so clearing it here and now
  // would post an empty address.
  function handleSubmit(e) {
    const form = e.currentTarget
    setTimeout(() => form.reset(), 0)
    setSent(true)
  }

  return (
    <section className="newsletter" aria-labelledby={headingId}>
      <div className="newsletter-inner">
        <h2 id={headingId} className="newsletter-heading">{heading}</h2>
        <form
          action="https://buttondown.com/api/emails/embed-subscribe/thelosttrailhead"
          method="post"
          target="_blank"
          className="embeddable-buttondown-form newsletter-form"
          onSubmit={handleSubmit}
        >
          <label htmlFor={inputId} className="visually-hidden">Enter your email</label>
          <div className="newsletter-row">
            <input
              type="email"
              name="email"
              id={inputId}
              className="newsletter-input"
              placeholder="Enter your email"
              autoComplete="email"
              required
            />
            <input type="submit" value="Subscribe" className="newsletter-submit" />
          </div>
          <p className="newsletter-powered">
            <a href="https://buttondown.com/refer/thelosttrailhead" target="_blank">Powered by Buttondown.</a>
          </p>
        </form>
        <p className="newsletter-note" role="status">
          {sent ? 'Thanks! Check your inbox to confirm.' : 'No spam. Unsubscribe anytime.'}
        </p>
      </div>
    </section>
  )
}
