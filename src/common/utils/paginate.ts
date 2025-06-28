import { ObjectLiteral, Repository } from 'typeorm';
import { Request } from 'express';

export interface PaginationParams {
  offset?: number;
  limit?: number;
  req: Request;
}

export interface PaginationResult<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export async function paginate<T extends ObjectLiteral>(
  repo: Repository<T>,
  { offset = 0, limit = 10, req }: PaginationParams,
): Promise<PaginationResult<T>> {
  const [results, count] = await repo.findAndCount({
    skip: offset,
    take: limit,
    order: { createdAt: 'DESC' as any },
  });

  const baseUrl = req.protocol + '://' + req.get('host') + req.path;
  const nextOffset = offset + limit;
  const prevOffset = Math.max(offset - limit, 0);

  return {
    count,
    next:
      offset + results.length < count
        ? `${baseUrl}?offset=${nextOffset}&limit=${limit}`
        : null,
    previous:
      offset > 0 ? `${baseUrl}?offset=${prevOffset}&limit=${limit}` : null,
    results,
  };
}
