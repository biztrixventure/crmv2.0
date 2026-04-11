# BizTrix CRM v2.0 - Theme Documentation

## 🎨 Design System

### Theme Overview
- **Light Mode:** Warm Amber/Brown palette - friendly and professional
- **Dark Mode:** Black Matte palette - modern and easy on the eyes
- **Transition Duration:** 0.3s ease on all theme-aware properties
- **Theme Switching:** CSS class-based (html.dark)

## 🎯 Color Palettes

### Light Mode - Warm Amber/Brown

```
Primary Colors (50-950):
50:   #F5EDE4  (Lightest - backgrounds)
100:  #E8D9C8
200:  #D4C0A5
300:  #C0A682
400:  #A88A62
500:  #8B7049  (Base primary)
600:  #6E5838  (Buttons, interactive)
700:  #524228  (Hover state)
800:  #3A2E1C  (Active state)
900:  #241C11  (Text color)
950:  #000000  (Pure black)

Accent Colors (Amber):
50:   #F7ECD8
100:  #EED9B3
200:  #E0C18A
300:  #D2A861
400:  #C49038
500:  #A67720
600:  #865F19
700:  #674812
800:  #4A330C
900:  #2E2007

Cream/Neutral Colors:
50:   #F8F3EB
100:  #F0E6D8
200:  #E4D4BE  (Scrollbar track)
300:  #D4BE9E
400:  #C4A77E  (Scrollbar thumb)
500:  #A8885C  (Default scrollbar thumb)
```

### Dark Mode - Black Matte

```
Primary Colors (50-900):
50:   #fafafa  (Lightest - text, accents)
100:  #f5f5f5
200:  #e5e5e5
300:  #d4d4d4
400:  #a3a3a3
500:  #737373
600:  #525252  (Buttons, interactive)
700:  #262626  (Secondary elements)
800:  #171717  (Cards, containers)
900:  #0a0a0a  (Background, darkest)

Scrollbar Colors:
Track: #0a0a0a
Thumb: #262626
Hover: #404040
```

## 🎨 Gradients

### Light Mode
```css
gradient-warm: 135deg from #E4D4BE → #D4BE9E → #C4A77E
gradient-sidebar: 180deg from #A8885C → #C4A77E
```

### Dark Mode
```css
gradient-warm-dark: 135deg from #171717 → #0a0a0a → #000000
gradient-sidebar-dark: 180deg from #262626 → #171717
```

## 🔧 CSS Variables

All theme properties are exposed as CSS variables for consistent usage across components:

```css
/* Background & Text */
--color-bg          /* Main background */
--color-text        /* Main text color */

/* Primary Colors */
--color-primary         /* Primary color 500 */
--color-primary-50      /* Through... */
--color-primary-900     /* All shades available */

/* Accents & Neutrals */
--color-accent          /* Accent color (light mode) */
--color-cream-200       /* Through cream colors... */
--color-cream-500

/* Scrollbar */
--scrollbar-track       /* Track color */
--scrollbar-thumb       /* Thumb color */
--scrollbar-thumb-hover /* Hover state */

/* Gradients */
--gradient-warm         /* Warm gradient */
--gradient-sidebar      /* Sidebar gradient */

/* Timing */
--transition-duration   /* 0.3s */
--transition-timing     /* ease */
```

## 🎛️ Tailwind Configuration

All custom colors are available as Tailwind utilities:

```jsx
// Primary colors
<div className="bg-primary-500 text-primary-900">
<button className="bg-primary-600 hover:bg-primary-700">

// Cream colors
<div className="bg-cream-200 border-cream-400">

// Gradients
<div className="bg-gradient-warm">
<aside className="bg-gradient-sidebar">

// Dark mode variants
<div className="dark:bg-primary-900 dark:text-primary-50">
```

## 🎨 Component Styles

All components automatically adapt to the current theme:

### Buttons
```jsx
<button className="btn-primary">Primary Button</button>
<button className="btn-secondary">Secondary Button</button>
```

### Cards
```jsx
<div className="card p-6">
  Responsive card that adapts to theme
</div>
```

### Inputs
```jsx
<input className="input" placeholder="Enter text..." />
```

### Alerts
```jsx
<div className="alert alert-success">Success message</div>
<div className="alert alert-error">Error message</div>
<div className="alert alert-warning">Warning message</div>
<div className="alert alert-info">Info message</div>
```

### Tables
```jsx
<table className="table">
  <thead>
    <tr>
      <th>Theme-aware table header</th>
    </tr>
  </thead>
</table>
```

## 🌙 Theme Switching

### Automatic Detection
The app automatically detects the system theme preference:

```javascript
// Checks:
1. localStorage.getItem("theme")  // User preference
2. window.matchMedia("(prefers-color-scheme: dark)")  // System preference
3. Default to "light"  // Fallback
```

### Manual Toggle
Users can toggle between light and dark mode via the theme button:

```jsx
<button onClick={toggleTheme}>
  {theme === "light" ? "🌙" : "☀️"}
</button>
```

### Applying Theme
The theme is applied by adding/removing the "dark" class on `<html>`:

```javascript
if (theme === "dark") {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}
```

## 📱 Responsive Design

All theme colors work responsively:
- Mobile-first design
- Dark mode respects reduced motion preferences
- Smooth transitions (0.3s) on all theme-aware properties

## ♿ Accessibility

- High contrast ratios between text and background
- Focus states clearly visible
- Color not used as only visual indicator
- Scrollbars remain visible in both themes

## 🎯 Usage Examples

### Using Theme in Components
```jsx
import { useTheme } from '../contexts/ThemeContext';

function MyComponent() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div style={{ backgroundColor: "var(--color-bg)" }}>
      Current theme: {theme}
      <button onClick={toggleTheme}>Toggle</button>
    </div>
  );
}
```

### Using Tailwind Classes
```jsx
export default function Card() {
  return (
    <div className="bg-gradient-warm dark:bg-gradient-warm-dark p-6 rounded-lg">
      <h2 className="text-primary-900 dark:text-primary-100">Title</h2>
      <p className="text-primary-600 dark:text-primary-400">Description</p>
    </div>
  );
}
```

### Using CSS Variables
```jsx
function StyledElement() {
  return (
    <div
      style={{
        backgroundColor: "var(--color-bg)",
        color: "var(--color-text)",
        borderColor: "var(--color-border)",
        transition: `all var(--transition-duration) var(--transition-timing)`
      }}
    >
      Styled with CSS variables
    </div>
  );
}
```

## 📝 Customization

To modify theme colors:

1. **Update Tailwind Config** (`frontend/tailwind.config.js`)
   - Add/modify color scales
   - Update gradient definitions

2. **Update CSS Variables** (`frontend/src/styles/global.css`)
   - Modify `:root` and `html.dark` sections
   - Add new custom properties

3. **Component Variants** (`@layer components` section)
   - Update button, card, input styles
   - Add new component styles

## 🐛 Troubleshooting

### Dark mode not applying?
```bash
# Check if "dark" class is on <html>
# Check localStorage theme value
localStorage.getItem("theme")  // should be "dark" or "light"
```

### Colors not changing?
```bash
# Verify CSS variables are used:
# ✅ var(--color-primary)
# ✅ var(--color-bg)
# ❌ #8B7049 (hardcoded values won't change)

# Clear browser cache and reload
Ctrl+Shift+Delete  # Firefox
Cmd+Shift+Delete  # Chrome/Edge
```

### Transitions too slow?
Change `--transition-duration` in CSS variables (default: 0.3s)

## 📊 Color Statistics

- **Primary Palette:** 11 shades (50-950)
- **Accent Palette:** 10 shades (50-900)
- **Neutral/Cream:** 5 shades
- **Total Custom Colors:** 26+ defined
- **CSS Variables:** 50+ available
- **Gradient Combinations:** 4 pre-defined

## 🎓 Best Practices

1. ✅ Always use CSS variables or Tailwind classes
2. ✅ Use `dark:` prefix for dark mode overrides
3. ✅ Test both light and dark modes
4. ✅ Use `smooth-transition` class for animated theme changes
5. ✅ Keep contrast ratios >= 4.5:1 for text
6. ❌ Don't hardcode color values
7. ❌ Don't use theme classes directly (use contextAPI)
8. ❌ Don't override transition durations without reason
