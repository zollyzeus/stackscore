import "./globals.css";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import { AuthProvider } from "./components/AuthProvider";
import IdleGuard from "./components/IdleGuard";

export const metadata = {
  title: "StackScore",
  description: "AI-judged engineering solutioning assessment - tests thinking, not just typing.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "StackScore",
    description: "AI-judged engineering solutioning assessment - tests thinking, not just typing.",
    images: [{ url: "/logo.png", width: 400, height: 400, alt: "StackScore" }],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "StackScore",
    description: "AI-judged engineering solutioning assessment - tests thinking, not just typing.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap"
        />
      </head>
      <body>
        {/* Inline script to set data-theme before first paint — prevents flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var stored = localStorage.getItem('ss_theme');
            if (stored === 'light' || stored === 'dark') {
              document.documentElement.setAttribute('data-theme', stored);
            }
          })();
        ` }} />
        <AuthProvider>
          <SiteHeader />
          <IdleGuard />
          {children}
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
