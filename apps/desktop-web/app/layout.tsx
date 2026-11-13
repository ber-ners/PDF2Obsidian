import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'PDF2Obsidian',
  description: '本地 PDF 解析、翻译与阅读工作台'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.theme='light';try{var t=localStorage.getItem('pdf2obsidian.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;else if(t==='system')delete document.documentElement.dataset.theme;}catch(e){}`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
