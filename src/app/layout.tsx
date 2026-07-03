import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'NarratorAI | AI 解说大师',
    template: '%s | NarratorAI',
  },
  description: 'AI 解说大师 — 一键生成爆款解说视频，智能剪辑合成，专业工具平台。',
  keywords: ['AI解说', '爆款解说', '视频合成', '智能剪辑', 'NarratorAI'],
  authors: [{ name: 'NarratorAI Team' }],
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.APP_ENV === 'DEV';
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/png" href="/favicon-32x32.png?v=3" />
        <link rel="apple-touch-icon" href="/favicon-32x32.png?v=3" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('narratorai_theme')||'dark';if(t==='dark')document.documentElement.classList.add('dark');})();`,
          }}
        />
      </head>
      <body className="antialiased">
        {isDev && <Inspector />}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
