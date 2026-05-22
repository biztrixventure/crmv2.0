import MarqueeBanner from './MarqueeBanner';
import AnnouncementPopup from './AnnouncementPopup';

// Top-of-app engagement surfaces shown in every shell:
//   - scrolling marquee strip (below the nav)
//   - center-screen announcement popup (priority-styled, re-shows on cadence)
const EngagementBanners = () => (
  <>
    <MarqueeBanner />
    <AnnouncementPopup />
  </>
);

export default EngagementBanners;
