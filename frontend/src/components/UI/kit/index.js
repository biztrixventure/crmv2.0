// ============================================================================
// UI kit — the shared primitives every SuperAdmin surface composes from, so a
// tab switch never changes the design language. See docs/ui-design-system.md.
//
//   import { Panel, SectionHeader, Loading, EmptyState } from '../../UI/kit';
//
// This is NOT the legacy ../index.js barrel (Button/Card/Badge/Alert/Modal/
// Table/Skeleton) — that one stays exactly as it is. Import the shared
// non-kit components straight from ../: ChromeTabs, Select (ThemedSelect),
// ThemedDate, DateRangePicker, Alert, Badge, Modal, DotGridBg.
// ============================================================================
export { default as Panel }         from './Panel';
export { default as SectionHeader } from './SectionHeader';
export { default as Loading }       from './Loading';
export { default as EmptyState }    from './EmptyState';
export { default as KpiTile }       from './KpiTile';
export { default as PillTabs }      from './PillTabs';
export { default as TableScroll }   from './TableScroll';
export { default as IconButton }    from './IconButton';
export { default as Field }         from './Field';
export { default as ActionRow }     from './ActionRow';
export { default as useFlash }      from './useFlash';
export { Toggle, CheckRow }         from './Toggle';
export { RADIUS, PAD, TONE, ACCENT, accent } from './tokens';
