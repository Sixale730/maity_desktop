/**
 * VoxelAccessories - Optional accessories for Crossy Road style avatar
 * Positioned for the new BIG head proportions
 */

import type { AccessoryCode, HeadType } from '@maity/shared';

interface VoxelAccessoriesProps {
  accessories: AccessoryCode[];
  headType?: HeadType;
}

// Head dimensions for positioning accessories
const HEAD_HEIGHTS: Record<HeadType, number> = {
  default: 1.3,
  round: 1.4,
  square: 1.2,
  tall: 1.5,
};

const HEAD_WIDTHS: Record<HeadType, number> = {
  default: 1.4,
  round: 1.5,
  square: 1.5,
  tall: 1.3,
};

export function VoxelAccessories({ accessories, headType = 'default' }: VoxelAccessoriesProps) {
  const headHeight = HEAD_HEIGHTS[headType];
  const headWidth = HEAD_WIDTHS[headType];

  // Base Y position where head center is (from VoxelHead: position={[0, 0.6, 0]})
  const headCenterY = 0.6;
  const headTopY = headCenterY + headHeight / 2;
  const eyeLevel = headCenterY + headHeight * 0.1;

  return (
    <group>
      {accessories.includes('glasses_round') && (
        <RoundGlasses eyeLevel={eyeLevel} headWidth={headWidth} />
      )}
      {accessories.includes('glasses_square') && (
        <SquareGlasses eyeLevel={eyeLevel} headWidth={headWidth} />
      )}
      {accessories.includes('hat_cap') && (
        <Cap headTopY={headTopY} headWidth={headWidth} />
      )}
      {accessories.includes('hat_beanie') && (
        <Beanie headTopY={headTopY} headWidth={headWidth} />
      )}
      {accessories.includes('headphones') && (
        <Headphones headCenterY={headCenterY} headWidth={headWidth} headHeight={headHeight} />
      )}
      {accessories.includes('bowtie') && <Bowtie />}
      {accessories.includes('necklace') && <Necklace />}
    </group>
  );
}

interface GlassesProps {
  eyeLevel: number;
  headWidth: number;
}

function RoundGlasses({ eyeLevel, headWidth }: GlassesProps) {
  const eyeX = headWidth * 0.18;
  const zPos = 0.62; // In front of face

  return (
    <group position={[0, eyeLevel, zPos]}>
      {/* Left lens frame */}
      <mesh position={[-eyeX, 0, 0]}>
        <torusGeometry args={[0.14, 0.025, 8, 16]} />
        <meshStandardMaterial color="#1A1A1A" />
      </mesh>
      {/* Right lens frame */}
      <mesh position={[eyeX, 0, 0]}>
        <torusGeometry args={[0.14, 0.025, 8, 16]} />
        <meshStandardMaterial color="#1A1A1A" />
      </mesh>
      {/* Bridge */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[eyeX * 0.8, 0.025, 0.025]} />
        <meshStandardMaterial color="#1A1A1A" />
      </mesh>
      {/* Left lens */}
      <mesh position={[-eyeX, 0, 0.01]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial color="#87CEEB" transparent opacity={0.3} />
      </mesh>
      {/* Right lens */}
      <mesh position={[eyeX, 0, 0.01]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial color="#87CEEB" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

function SquareGlasses({ eyeLevel, headWidth }: GlassesProps) {
  const eyeX = headWidth * 0.18;
  const zPos = 0.62;

  return (
    <group position={[0, eyeLevel, zPos]}>
      {/* Left lens frame */}
      <mesh position={[-eyeX, 0, 0]}>
        <boxGeometry args={[0.26, 0.2, 0.025]} />
        <meshStandardMaterial color="#1A1A1A" />
      </mesh>
      {/* Right lens frame */}
      <mesh position={[eyeX, 0, 0]}>
        <boxGeometry args={[0.26, 0.2, 0.025]} />
        <meshStandardMaterial color="#1A1A1A" />
      </mesh>
      {/* Bridge */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[eyeX * 0.6, 0.035, 0.025]} />
        <meshStandardMaterial color="#1A1A1A" />
      </mesh>
      {/* Left lens (inner) */}
      <mesh position={[-eyeX, 0, 0.02]}>
        <boxGeometry args={[0.22, 0.16, 0.01]} />
        <meshStandardMaterial color="#333333" transparent opacity={0.5} />
      </mesh>
      {/* Right lens (inner) */}
      <mesh position={[eyeX, 0, 0.02]}>
        <boxGeometry args={[0.22, 0.16, 0.01]} />
        <meshStandardMaterial color="#333333" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

interface HatProps {
  headTopY: number;
  headWidth: number;
}

function Cap({ headTopY, headWidth }: HatProps) {
  return (
    <group position={[0, headTopY + 0.12, 0]}>
      {/* Cap dome */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[headWidth * 0.95, 0.28, headWidth * 0.85]} />
        <meshStandardMaterial color="#1E40AF" flatShading />
      </mesh>
      {/* Cap brim */}
      <mesh position={[0, -0.08, headWidth * 0.45]} castShadow>
        <boxGeometry args={[headWidth * 0.7, 0.1, 0.4]} />
        <meshStandardMaterial color="#1E40AF" flatShading />
      </mesh>
      {/* Button on top */}
      <mesh position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.12, 0.1, 0.12]} />
        <meshStandardMaterial color="#1E40AF" flatShading />
      </mesh>
    </group>
  );
}

function Beanie({ headTopY, headWidth }: HatProps) {
  return (
    <group position={[0, headTopY + 0.15, 0]}>
      {/* Beanie main */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[headWidth * 0.95, 0.4, headWidth * 0.85]} />
        <meshStandardMaterial color="#DC2626" flatShading />
      </mesh>
      {/* Beanie fold */}
      <mesh position={[0, -0.1, 0]} castShadow>
        <boxGeometry args={[headWidth * 0.98, 0.14, headWidth * 0.88]} />
        <meshStandardMaterial color="#B91C1C" flatShading />
      </mesh>
      {/* Pom pom */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color="#FFFFFF" flatShading />
      </mesh>
    </group>
  );
}

interface HeadphonesProps {
  headCenterY: number;
  headWidth: number;
  headHeight: number;
}

function Headphones({ headCenterY, headWidth, headHeight }: HeadphonesProps) {
  const topY = headCenterY + headHeight / 2;
  const sideX = headWidth / 2 + 0.08;

  return (
    <group position={[0, headCenterY, 0]}>
      {/* Headband */}
      <mesh position={[0, topY - headCenterY + 0.1, 0]} castShadow>
        <boxGeometry args={[headWidth * 0.95, 0.1, 0.18]} />
        <meshStandardMaterial color="#374151" flatShading />
      </mesh>
      {/* Left ear cup */}
      <mesh position={[-sideX, 0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.4, 0.35]} />
        <meshStandardMaterial color="#374151" flatShading />
      </mesh>
      {/* Right ear cup */}
      <mesh position={[sideX, 0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.4, 0.35]} />
        <meshStandardMaterial color="#374151" flatShading />
      </mesh>
      {/* Left cushion */}
      <mesh position={[-sideX + 0.05, 0, 0]}>
        <boxGeometry args={[0.1, 0.35, 0.3]} />
        <meshStandardMaterial color="#1F2937" flatShading />
      </mesh>
      {/* Right cushion */}
      <mesh position={[sideX - 0.05, 0, 0]}>
        <boxGeometry args={[0.1, 0.35, 0.3]} />
        <meshStandardMaterial color="#1F2937" flatShading />
      </mesh>
    </group>
  );
}

function Bowtie() {
  // Position on body torso
  return (
    <group position={[0, -0.05, 0.32]}>
      {/* Left wing */}
      <mesh position={[-0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.14, 0.1, 0.06]} />
        <meshStandardMaterial color="#DC2626" flatShading />
      </mesh>
      {/* Right wing */}
      <mesh position={[0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.14, 0.1, 0.06]} />
        <meshStandardMaterial color="#DC2626" flatShading />
      </mesh>
      {/* Center knot */}
      <mesh position={[0, 0, 0.025]} castShadow>
        <boxGeometry args={[0.06, 0.08, 0.04]} />
        <meshStandardMaterial color="#B91C1C" flatShading />
      </mesh>
    </group>
  );
}

function Necklace() {
  // Position on body torso
  return (
    <group position={[0, -0.1, 0.31]}>
      {/* Chain */}
      <mesh position={[0, 0, 0]}>
        <torusGeometry args={[0.18, 0.018, 8, 24]} />
        <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Pendant */}
      <mesh position={[0, -0.15, 0.025]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.025]} />
        <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}
