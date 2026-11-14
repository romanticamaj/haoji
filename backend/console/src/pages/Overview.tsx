import { api } from '../api';
import { Page } from '../components/Page';
import { usePoll } from '../usePoll';
import type { StatusDetail } from '../types';

export function Overview() {
  usePoll(() => api.get<StatusDetail>('/api/status?detail=1'));
  return <Page zh="總覽" en="Overview">{null}</Page>;
}
