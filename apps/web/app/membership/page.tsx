import Link from 'next/link';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import { formatPriceCents } from '@/lib/format';

const MONTHLY_PLAN = {
  name: '月度会员',
  priceCents: 29900,
  description: '解锁全站短剧全集、无广告播放、高清画质，随时取消。',
};

export default function MembershipPage() {
  return (
    <>
      <TopBar />
      <main className="membership-page">
        <header className="home-intro">
          <h1>会员方案</h1>
          <p>选择适合你的会员方案，解锁全部短剧。</p>
        </header>

        <article className="plan-card">
          <div className="eyebrow">VIP</div>
          <h2>{MONTHLY_PLAN.name}</h2>
          <strong>{formatPriceCents(MONTHLY_PLAN.priceCents)} / 月</strong>
          <span>{MONTHLY_PLAN.description}</span>
          <button className="vip-btn" disabled title="会员支付功能即将开放">
            开通会员（即将开放）
          </button>
        </article>

        <p className="plan-note">需要单独解锁某部短剧？在该短剧详情页选择「去解锁」即可。</p>
        <p className="plan-note">
          <Link href="/">返回短剧馆</Link>
        </p>
      </main>
      <BottomNav />
    </>
  );
}
