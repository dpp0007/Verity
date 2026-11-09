import { NextResponse } from 'next/server';
import { openapi } from '@/lib/openapi';

export const GET = () => NextResponse.json(openapi);
