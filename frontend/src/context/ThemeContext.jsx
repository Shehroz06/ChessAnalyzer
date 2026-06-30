import { createContext, useContext, useState, useEffect } from 'react';

const Ctx = createContext(null);

export function ThemeProvider({ children }) {
  const [isLight, setIsLight] = useState(false); // dark by default

  useEffect(() => {
    document.documentElement.classList.toggle('light', isLight);
  }, [isLight]);

  return (
    <Ctx.Provider value={{ isLight, toggle: () => setIsLight(v => !v) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
