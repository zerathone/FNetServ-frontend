import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './app/router'
import { ToastHost } from './components/ToastHost'
import { ThemeProvider } from './design-system/theme/ThemeProvider'
import './App.css'
import { ServerEventsProvider } from './ws/ServerEventsProvider'

const queryClient = new QueryClient()

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ServerEventsProvider>
          <BrowserRouter>
            <AppRouter />
            <ToastHost />
          </BrowserRouter>
        </ServerEventsProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
