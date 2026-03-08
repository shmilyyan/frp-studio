import { theme } from 'ant-design-vue'

export const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#1668dc',
    colorBgContainer: '#1f1f1f',
    colorBgElevated: '#2a2a2a',
    colorBgLayout: '#141414',
    colorBorder: '#303030',
    colorBorderSecondary: '#262626',
    borderRadius: 6,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  },
  components: {
    Layout: {
      siderBg: '#1a1a1a',
      bodyBg: '#141414'
    },
    Menu: {
      darkItemBg: '#1a1a1a',
      darkSubMenuItemBg: '#161616',
      darkItemSelectedBg: '#1668dc'
    },
    Card: {
      colorBgContainer: '#1f1f1f'
    },
    Table: {
      colorBgContainer: '#1f1f1f',
      headerBg: '#262626'
    },
    Modal: {
      contentBg: '#1f1f1f',
      headerBg: '#1f1f1f'
    }
  }
}
