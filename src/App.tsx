import { useEffect, useState } from 'react';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';

type Route = 'user' | 'admin';

function getRoute(): Route {
  return window.location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'user';
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', '/user');
    }

    const handlePopState = () => setRoute(getRoute());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return route === 'admin' ? <AdminDashboard /> : <UserDashboard />;
}
