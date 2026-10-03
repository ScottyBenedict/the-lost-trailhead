// Buttondown's own embed form, posted straight to Buttondown — no API key and
// nothing stored here. target="_blank" opens Buttondown's confirmation page in
// a new tab so the visitor stays on the site.
export default function NewsletterSignup() {
  return (
    <section className="newsletter" aria-labelledby="newsletter-heading">
      <h2 id="newsletter-heading" className="newsletter-heading">New hikes in your inbox</h2>
      <form
        action="https://buttondown.com/api/emails/embed-subscribe/thelosttrailhead"
        method="post"
        target="_blank"
        className="embeddable-buttondown-form newsletter-form"
      >
        <label htmlFor="bd-email" className="visually-hidden">Enter your email</label>
        <div className="newsletter-row">
          <input
            type="email"
            name="email"
            id="bd-email"
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
    </section>
  )
}
