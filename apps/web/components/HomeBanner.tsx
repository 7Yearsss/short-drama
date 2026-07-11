'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchHomeBanners, BannerSeries } from '@/lib/api-client';

const AUTOPLAY_INTERVAL_MS = 4500;
const RESUME_DELAY_MS = 3000;

export default function HomeBanner() {
  const [banners, setBanners] = useState<BannerSeries[] | null>(null);
  const [scales, setScales] = useState<number[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const autoplayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndex = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchHomeBanners()
      .then((items) => {
        if (!cancelled) setBanners(items);
      })
      .catch(() => {
        if (!cancelled) setBanners([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function recomputeScales() {
    const track = trackRef.current;
    if (!track) return;

    const cards = Array.from(track.children) as HTMLElement[];
    const center = track.scrollLeft + track.clientWidth / 2;
    const trackWidth = track.clientWidth || 1;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    const nextScales = cards.map((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(center - cardCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
      const ratio = Math.max(0, 1 - distance / trackWidth);
      return 0.85 + ratio * 0.15;
    });

    activeIndex.current = closestIndex;
    setScales(nextScales);
  }

  function stopAutoplay() {
    if (autoplayTimer.current) clearInterval(autoplayTimer.current);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    autoplayTimer.current = null;
    resumeTimer.current = null;
  }

  function startAutoplay() {
    stopAutoplay();
    if (!banners || banners.length <= 1) return;

    autoplayTimer.current = setInterval(() => {
      const track = trackRef.current;
      if (!track) return;
      const cards = Array.from(track.children) as HTMLElement[];
      activeIndex.current = (activeIndex.current + 1) % cards.length;
      const target = cards[activeIndex.current];
      track.scrollTo({
        left: target.offsetLeft - (track.clientWidth - target.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }, AUTOPLAY_INTERVAL_MS);
  }

  function scheduleResume() {
    stopAutoplay();
    resumeTimer.current = setTimeout(startAutoplay, RESUME_DELAY_MS);
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !banners || banners.length === 0) return;

    const frame = requestAnimationFrame(recomputeScales);
    track.addEventListener('scroll', recomputeScales, { passive: true });
    window.addEventListener('resize', recomputeScales);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener('scroll', recomputeScales);
      window.removeEventListener('resize', recomputeScales);
    };
  }, [banners]);

  useEffect(() => {
    startAutoplay();
    return stopAutoplay;
  }, [banners]);

  if (!banners || banners.length === 0) return null;

  return (
    <section
      className="home-banner"
      aria-label="推荐短剧"
      onPointerDown={stopAutoplay}
      onPointerUp={scheduleResume}
      onPointerCancel={scheduleResume}
    >
      <div className={banners.length === 1 ? 'home-banner-track single' : 'home-banner-track'} ref={trackRef}>
        {banners.map((banner, index) => {
          const scale = scales[index] ?? (banners.length === 1 ? 1 : 0.85);
          const opacity = 0.4 + ((scale - 0.85) / 0.15) * 0.6;
          return (
            <Link
              key={banner.id}
              href={`/series/${banner.id}`}
              className="home-banner-card"
              style={{
                transform: `scale(${scale})`,
                opacity,
                backgroundImage: banner.coverUrl ? `url(${banner.coverUrl})` : undefined,
              }}
            >
              <span className="home-banner-title">{banner.title}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
