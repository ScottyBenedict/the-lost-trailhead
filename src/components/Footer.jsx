export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-logo">The Lost Trailhead</span>
        <span className="footer-tagline">Scott &amp; Alan · Pacific Northwest</span>
        <span className="footer-copy">© {new Date().getFullYear()}</span>
      </div>
    </footer>
  )
}
