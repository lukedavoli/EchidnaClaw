import { NavLink, useLocation } from 'react-router-dom';

const navItems = [
  {
    label: 'Agents',
    to: '/agents',
  },
  {
    label: 'Analytics',
    to: '/analytics',
  },
];

export function AppNav() {
  const location = useLocation();

  return (
    <nav aria-label="Primary" className="app-nav">
      {navItems.map((item) => {
        const active =
          item.to === '/agents'
            ? location.pathname.startsWith('/agents')
            : location.pathname.startsWith(item.to);

        return (
          <NavLink
            className="app-nav__link"
            data-active={active ? 'true' : 'false'}
            key={item.to}
            to={item.to}
          >
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
