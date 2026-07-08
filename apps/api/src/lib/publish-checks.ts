export interface PublishCheckItem {
  code: string;
  message: string;
}

export interface PublishCheckInput {
  title: string;
  description: string | null;
  coverUrl: string | null;
  unlockPriceCents: number;
  freeEpisodeCount: number;
  updateStatus: string;
  publishedEpisodeCount: number;
  draftEpisodeCount: number;
  processingEpisodeCount: number;
  failedEpisodeCount: number;
  episodeNumbers: number[];
}

export function evaluateSeriesPublishChecks(input: PublishCheckInput) {
  const blockers: PublishCheckItem[] = [];
  const warnings: PublishCheckItem[] = [];

  if (!input.title.trim()) blockers.push({ code: 'missing_title', message: '请先填写剧名' });
  if (!input.coverUrl) blockers.push({ code: 'missing_cover', message: '请先上传封面' });
  if (input.publishedEpisodeCount + input.draftEpisodeCount === 0) {
    blockers.push({ code: 'missing_episodes', message: '请先上传至少一集' });
  }
  if (input.publishedEpisodeCount === 0 && input.processingEpisodeCount > 0) {
    blockers.push({ code: 'first_publish_has_processing', message: '首批集数仍在转码中' });
  }
  if (input.unlockPriceCents > 0 && input.freeEpisodeCount < 0) {
    blockers.push({ code: 'invalid_free_episode_count', message: '免费集数不能小于 0' });
  }

  if (!input.description?.trim()) warnings.push({ code: 'missing_description', message: '建议补充简介' });
  if (input.failedEpisodeCount > 0) warnings.push({ code: 'has_failed_episodes', message: '存在转码失败的集数' });
  if (hasGap(input.episodeNumbers)) warnings.push({ code: 'episode_number_gap', message: '集数不连续' });
  if (input.unlockPriceCents > 0 && input.freeEpisodeCount > input.publishedEpisodeCount) {
    warnings.push({ code: 'free_count_exceeds_published', message: '免费集数大于当前已上架集数' });
  }
  if (input.updateStatus === 'completed' && input.episodeNumbers.length < 3) {
    warnings.push({ code: 'completed_with_few_episodes', message: '已完结剧集的集数较少' });
  }

  return { blockers, warnings };
}

function hasGap(numbers: number[]): boolean {
  if (numbers.length <= 1) return false;
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] !== sorted[index - 1] + 1) return true;
  }
  return false;
}
