/**
 * VoxelHuman - Customizable human character
 * Uses VoxelHead, VoxelBody, and VoxelAccessories
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VoxelHead } from './VoxelHead';
import { VoxelBody } from './VoxelBody';
import { VoxelAccessories } from './VoxelAccessories';
import type { HeadType, BodyType, AccessoryCode, OutfitPreset } from '@maity/shared';

interface VoxelHumanProps {
  headType: HeadType;
  bodyType: BodyType;
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  accessories: AccessoryCode[];
  outfitPreset?: OutfitPreset;
  animate?: boolean;
}

export function VoxelHuman({
  headType,
  bodyType,
  skinColor,
  hairColor,
  shirtColor,
  pantsColor,
  accessories,
  outfitPreset,
  animate = false,
}: VoxelHumanProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Crossy Road style idle animation - gentle bounce
  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      // Subtle bounce effect
      groupRef.current.position.y = Math.sin(time * 2.5) * 0.04;
      // Very subtle side-to-side sway
      groupRef.current.rotation.z = Math.sin(time * 1.5) * 0.02;
    }
  });

  return (
    <group ref={groupRef}>
      {/* BIG HEAD - the star of the show */}
      <VoxelHead
        headType={headType}
        skinColor={skinColor}
        hairColor={hairColor}
      />

      {/* Compact body directly underneath */}
      <VoxelBody
        bodyType={bodyType}
        shirtColor={shirtColor}
        pantsColor={pantsColor}
        skinColor={skinColor}
        outfitPreset={outfitPreset}
      />

      {/* Accessories positioned relative to character */}
      {accessories.length > 0 && (
        <VoxelAccessories
          accessories={accessories}
          headType={headType}
        />
      )}

      {/* Ground shadow - circular for that Crossy Road feel */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.85, 0]} receiveShadow>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.15}
        />
      </mesh>
    </group>
  );
}

export default VoxelHuman;
