import Link from 'next/link';
import { fetchSeriesList } from '@/lib/api-client';

export default async function HomePage() {
  const seriesList = await fetchSeriesList();
  return (
    <main style={{ padding: 24 }}>
      <h1>短剧馆</h1>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }}>
        {seriesList.map((series) => (
          <li key={series.id}>
            <Link href={`/series/${series.id}`}>
              <h2>{series.title}</h2>
              {series.description && <p>{series.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
      {seriesList.length === 0 && <p>暂无上架剧集</p>}
    </main>
  );
}
