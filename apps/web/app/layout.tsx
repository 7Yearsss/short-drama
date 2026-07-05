export const metadata = {
  title: '短剧馆',
  description: '台湾短剧会员平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
