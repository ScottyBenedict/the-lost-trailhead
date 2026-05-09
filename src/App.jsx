import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Nav from './components/Nav'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import HikePage from './pages/HikePage'
import AboutPage from './pages/AboutPage'
import GearPage from './pages/GearPage'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/hikes/:slug" element={<HikePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/gear" element={<GearPage />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  )
}
