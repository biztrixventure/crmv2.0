import MarqueeBanner from './MarqueeBanner';
import AnnouncementBanner from './AnnouncementBanner';

// Top-of-app strips shown below the nav in every shell: scrolling marquee +
// unread announcement banners (urgent/high prominent).
const EngagementBanners = () => (
  <>
    <MarqueeBanner />
    <AnnouncementBanner />
  </>
);

export default EngagementBanners;
