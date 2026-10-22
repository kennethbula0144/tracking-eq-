import { useEffect, useState } from 'react';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';

type Route = 'user' | 'admin';

function getRoute(): Route {
  // Strips trailing slashes so both "/admin" and "/admin/" return 'admin'
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '/admin' ? 'admin' : 'user';
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    // Redirect root URL '/' to '/user'
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState(null, '', '/user');
    }

    const handlePopState = () => setRoute(getRoute());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return route === 'admin' ? <AdminDashboard /> : <UserDashboard />;
}