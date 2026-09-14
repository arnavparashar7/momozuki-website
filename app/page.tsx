import { Nav } from '@/components/momozuki/Nav';
import { CinematicHero3D } from '@/components/momozuki/CinematicHero3D';
import { DetailsSection } from '@/components/momozuki/DetailsSection';
import { ClaimFlow } from '@/components/momozuki/ClaimFlow';
import { Footer } from '@/components/momozuki/Footer';

export default function HomePage() {
  return (
    <>
      <div className="grain" />
      <Nav />
      <CinematicHero3D />
      <div
        className="torn"
        aria-hidden="true"
        dangerouslySetInnerHTML={{
          __html:
            '<svg viewBox="0 0 1200 26" preserveAspectRatio="none" style="display:block;width:100%;height:100%;"><polygon fill="#F1E8D0" points="0,26 0,10 30,18 60,6 90,16 120,4 150,14 180,8 210,18 240,6 270,16 300,10 330,20 360,4 390,14 420,8 450,18 480,6 510,16 540,10 570,20 600,4 630,14 660,8 690,18 720,6 750,16 780,10 810,20 840,4 870,14 900,8 930,18 960,6 990,16 1020,10 1050,20 1080,4 1110,14 1140,8 1170,18 1200,10 1200,26"/></svg>',
        }}
      />
      <DetailsSection />
      <div id="claim">
        <ClaimFlow />
      </div>
      <Footer />
    </>
  );
}
