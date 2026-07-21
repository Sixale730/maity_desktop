/**
 * VoxelBody - Authentic Crossy Road style body
 * COMPACT body (35% of character), no neck, stubby limbs
 */

import { useRef } from 'react';
import * as THREE from 'three';
import type { BodyType, OutfitPreset } from '@maity/shared';
import { OUTFIT_PRESETS } from '@maity/shared';

interface VoxelBodyProps {
  bodyType: BodyType;
  shirtColor: string;
  pantsColor: string;
  skinColor: string;
  outfitPreset?: OutfitPreset;
}

interface BodyConfig {
  torso: [number, number, number];
  legHeight: number;
  legWidth: number;
  armLength: number;
  armWidth: number;
  hasArms: boolean;
}

// CROSSY ROAD PROPORTIONS: Balanced body with taller torso
const BODY_CONFIG: Record<BodyType, BodyConfig> = {
  default: {
    torso: [0.65, 0.55, 0.45],    // Taller torso, rectangular block
    legHeight: 0.32,              // Longer legs
    legWidth: 0.2,                // Slimmer legs
    armLength: 0.35,              // Longer arms
    armWidth: 0.14,               // Slimmer arms
    hasArms: true,
  },
  slim: {
    torso: [0.55, 0.6, 0.4],      // Taller, slimmer
    legHeight: 0.35,
    legWidth: 0.16,
    armLength: 0.38,
    armWidth: 0.12,
    hasArms: true,
  },
  athletic: {
    torso: [0.7, 0.5, 0.5],       // Wider, medium height
    legHeight: 0.3,
    legWidth: 0.22,
    armLength: 0.32,
    armWidth: 0.16,
    hasArms: true,
  },
  casual: {
    torso: [0.6, 0.5, 0.45],
    legHeight: 0.28,
    legWidth: 0.22,
    armLength: 0,
    armWidth: 0,
    hasArms: false, // Some Crossy Road characters have no visible arms
  },
};

export function VoxelBody({ bodyType, shirtColor, pantsColor, skinColor, outfitPreset }: VoxelBodyProps) {
  const groupRef = useRef<THREE.Group>(null);
  const config = BODY_CONFIG[bodyType];
  const [torsoW, torsoH, torsoD] = config.torso;

  // Position calculations - body starts below the head
  const torsoY = 0;  // Torso centered at origin
  const legY = torsoY - torsoH / 2 - config.legHeight / 2;
  const armX = torsoW / 2 + config.armWidth / 2 + 0.01;
  const armY = torsoY + torsoH * 0.2;  // Arms at upper part of torso

  // Leg spacing based on torso width
  const legSpacing = torsoW * 0.3;

  // Check if outfit has a tie
  const outfit = outfitPreset ? OUTFIT_PRESETS.find(o => o.id === outfitPreset) : null;
  const hasTie = outfit?.hasTie ?? false;
  const tieColor = outfit?.tieColor ?? '#DC2626';

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Torso - rectangular block */}
      <mesh position={[0, torsoY, 0]} castShadow receiveShadow>
        <boxGeometry args={[torsoW, torsoH, torsoD]} />
        <meshStandardMaterial color={shirtColor} flatShading roughness={0.8} />
      </mesh>

      {/* Tie - for business outfit */}
      {hasTie && (
        <group position={[0, torsoY + torsoH * 0.15, torsoD / 2 + 0.01]}>
          {/* Tie knot */}
          <mesh position={[0, 0.08, 0]} castShadow>
            <boxGeometry args={[0.08, 0.06, 0.03]} />
            <meshStandardMaterial color={tieColor} flatShading roughness={0.7} />
          </mesh>
          {/* Tie body */}
          <mesh position={[0, -0.08, 0]} castShadow>
            <boxGeometry args={[0.1, 0.25, 0.02]} />
            <meshStandardMaterial color={tieColor} flatShading roughness={0.7} />
          </mesh>
          {/* Tie point */}
          <mesh position={[0, -0.24, 0]} castShadow>
            <boxGeometry args={[0.06, 0.08, 0.02]} />
            <meshStandardMaterial color={tieColor} flatShading roughness={0.7} />
          </mesh>
        </group>
      )}

      {/* Arms - rectangular blocks extending from sides */}
      {config.hasArms && (
        <>
          {/* Left Arm */}
          <mesh position={[-armX, armY, 0]} castShadow>
            <boxGeometry args={[config.armWidth, config.armLength, config.armWidth]} />
            <meshStandardMaterial color={shirtColor} flatShading roughness={0.8} />
          </mesh>

          {/* Right Arm */}
          <mesh position={[armX, armY, 0]} castShadow>
            <boxGeometry args={[config.armWidth, config.armLength, config.armWidth]} />
            <meshStandardMaterial color={shirtColor} flatShading roughness={0.8} />
          </mesh>

          {/* Hands - small skin-colored cubes */}
          <mesh position={[-armX, armY - config.armLength / 2 - 0.04, 0]} castShadow>
            <boxGeometry args={[0.08, 0.08, 0.08]} />
            <meshStandardMaterial color={skinColor} flatShading roughness={0.8} />
          </mesh>
          <mesh position={[armX, armY - config.armLength / 2 - 0.04, 0]} castShadow>
            <boxGeometry args={[0.08, 0.08, 0.08]} />
            <meshStandardMaterial color={skinColor} flatShading roughness={0.8} />
          </mesh>
        </>
      )}

      {/* Legs - rectangular blocks */}
      <mesh position={[-legSpacing, legY, 0]} castShadow>
        <boxGeometry args={[config.legWidth, config.legHeight, torsoD * 0.7]} />
        <meshStandardMaterial color={pantsColor} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[legSpacing, legY, 0]} castShadow>
        <boxGeometry args={[config.legWidth, config.legHeight, torsoD * 0.7]} />
        <meshStandardMaterial color={pantsColor} flatShading roughness={0.8} />
      </mesh>

      {/* Feet - simple blocks (Crossy Road style - minimal) */}
      <mesh position={[-legSpacing, legY - config.legHeight / 2 - 0.05, 0.02]} castShadow>
        <boxGeometry args={[config.legWidth, 0.1, torsoD * 0.6]} />
        <meshStandardMaterial color="#2D2D2D" flatShading roughness={0.9} />
      </mesh>
      <mesh position={[legSpacing, legY - config.legHeight / 2 - 0.05, 0.02]} castShadow>
        <boxGeometry args={[config.legWidth, 0.1, torsoD * 0.6]} />
        <meshStandardMaterial color="#2D2D2D" flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}
