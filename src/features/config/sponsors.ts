/**
 * Sponsored proxy links shown in System > Optional resources, never inside the Config form.
 * Front-end constants only; an empty list hides the entries.
 */
import bestproxyLogo from '@/assets/icons/bestproxy.png';

export type Sponsor = {
  /** Brand name, shown untranslated. */
  name: string;
  url: string;
  logo?: string;
};

export const SPONSORS: readonly Sponsor[] = [
  {
    name: 'BestProxy.com',
    url: 'https://bestproxy.com/?keyword=ayh7otlb',
    logo: bestproxyLogo,
  },
];
