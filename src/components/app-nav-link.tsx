'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';
import type { ComponentProps } from 'react';

type AppNavLinkProps = ComponentProps<typeof Link>;

export function AppNavLink({ href, onFocus, onPointerEnter, ...props }: AppNavLinkProps) {
  const router = useRouter();
  const prefetchedRef = useRef(false);

  const prefetchOnIntent = useCallback(() => {
    if (prefetchedRef.current || typeof href !== 'string' || !href.startsWith('/')) return;
    prefetchedRef.current = true;
    router.prefetch(href);
  }, [href, router]);

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) prefetchOnIntent();
      }}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) prefetchOnIntent();
      }}
    />
  );
}
