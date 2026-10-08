import type { ImgHTMLAttributes } from 'react';

type Props = ImgHTMLAttributes<HTMLImageElement> & { src:string; alt:string; fill?:boolean; unoptimized?:boolean };
export default function Image({ fill, unoptimized, ...props }: Props) {
  void unoptimized;
  return <img {...props} alt={props.alt} style={{ ...(fill ? { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' } as const : {}), ...props.style }} />;
}
