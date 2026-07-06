'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="bottom-nav-wrap">
      <nav className="bottom-nav" aria-label="移动端导航">
        <Link href="/" className={pathname === '/' ? 'is-active' : ''}>
          首页
        </Link>
        <Link href="/membership" className={pathname === '/membership' ? 'is-active' : ''}>
          会员
        </Link>
      </nav>
    </div>
  );
}
