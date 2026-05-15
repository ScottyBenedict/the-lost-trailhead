import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Nav from './components/Nav'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import HikePage from './pages/HikePage'
import AboutPage from './pages/AboutPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminPage from './pages/AdminPage'
import ProtectedRoute from './components/ProtectedRoute'
import './App.css'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

function AuthRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('type=recovery') || hash.includes('type=invite')) {
      navigate('/admin/login' + hash, { replace: true })
    }
  }, [navigate])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthRedirect />
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={
          <ProtectedRoute><AdminPage /></ProtectedRoute>
        } />
        <Route path="*" element={
          <>
            <Nav />
            <main>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/hikes/:slug" element={<HikePage />} />
                <Route path="/about" element={<AboutPage />} />
              </Routes>
            </main>
            <Footer />
          </>
        } />
      </Routes>
    </BrowserRouter>
  )
}
