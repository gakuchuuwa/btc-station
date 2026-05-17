import Header from '@/components/Header'
import Footer from '@/components/Footer'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>
        <div className="wrap">
          {children}
        </div>
      </main>
      <Footer />
    </>
  )
}
