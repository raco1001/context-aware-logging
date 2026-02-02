export const ROUTE_PATTERN_CONSTANTS: Array<{
  keywords: string[];
  route: string;
}> = [
  {
    keywords: ['checkout', 'check-out', 'check out'],
    route: '/payments/checkout',
  },
  {
    keywords: ['payment', 'pay', 'billing'],
    route: '/payments',
  },
  {
    keywords: ['embedding', 'embed', 'vector'],
    route: '/embeddings',
  },
  {
    keywords: ['search', 'query', 'ask'],
    route: '/search',
  },
  {
    keywords: ['user', 'profile', 'account'],
    route: '/users',
  },
  {
    keywords: ['order', 'purchase'],
    route: '/orders',
  },
  {
    keywords: ['product', 'item', 'catalog'],
    route: '/products',
  },
  {
    keywords: ['cart', 'basket'],
    route: '/carts',
  },
];
