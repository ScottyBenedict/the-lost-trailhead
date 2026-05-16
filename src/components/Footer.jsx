export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-tagline">Alan &amp; Scott · Pacific Northwest</span>
        <span className="footer-copy">© {new Date().getFullYear()} The Lost Trailhead</span>
      </div>
      <div className="footer-legal">
        All photographs and written content are the property of The Lost Trailhead and may not be reproduced or used without permission.
      </div>
    </footer>
  )
}
