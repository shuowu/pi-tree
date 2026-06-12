import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'Pi-tree',
  description: 'AI-assisted reading and research with tree-structured conversations',
  base: '/pi-tree/',

  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
  ],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/pi-tree/logo.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700&display=swap', rel: 'stylesheet' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Pi-tree — AI Reading Companion' }],
    ['meta', { property: 'og:description', content: 'AI-assisted reading and research with tree-structured conversations. Local-first, bring your own key.' }],
    ['meta', { property: 'og:image', content: 'https://shuowu.github.io/pi-tree/og-image.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Pi-tree',

    nav: [
      {
        text: 'Docs',
        link: '/docs/getting-started',
        activeMatch: '/docs/',
      },
      { text: 'Vision', link: '/vision' },
    ],

    sidebar: {
      '/docs/': [
        {
          text: 'Setup',
          items: [
            { text: 'Quick Start', link: '/docs/getting-started' },
            { text: 'Docker', link: '/docs/docker' },
            { text: 'Models & Providers', link: '/docs/models' },
            { text: 'Self-Hosting', link: '/docs/self-hosting' },
          ],
        },
        {
          text: 'Guides',
          items: [
            { text: 'Examples', link: '/docs/examples' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/docs/architecture' },
            { text: 'Session Management', link: '/docs/sessions' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/shuowu/pi-tree' },
    ],

    footer: {
      message: 'Released under the AGPL-3.0 License.',
      copyright: 'Built with ❤️ on the Pi SDK',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/shuowu/pi-tree/edit/master/website/:path',
      text: 'Edit this page on GitHub',
    },
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },

  mermaid: {
    theme: 'neutral',
  },
}))
