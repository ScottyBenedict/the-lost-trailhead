import { useId } from 'react'

// Buttondown's own embed form, posted straight to Buttondown — no API key and
// nothing stored here. target="_blank" opens Buttondown's confirmation page in
// a new tab so the visitor stays on the site.
// Ids come from useId so the label and heading stay unique on the page.
export default function NewsletterSignup({ heading = 'New hikes in your inbox' }) {
  const id = useId()
  const inputId = `bd-email-${id}`
  const headingId = `newsletter-heading-${id}`
  return (
    <section className="newsletter" aria-labelledby={headingId}>
      <div className="newsletter-inner">
        <h2 id={headingId} className="newsletter-heading">{heading}</h2>
        <form
          action="https://buttondown.com/api/emails/embed-subscribe/thelosttrailhead"
          method="post"
          target="_blank"
          className="embeddable-buttondown-form newsletter-form"
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
        <p className="newsletter-note">No spam. Unsubscribe anytime.</p>
      </div>
    </section>
  )
}
