// topojson-client ships no types (it comes in with react-simple-maps); the county map uses two functions.
declare module "topojson-client" {
  export function feature(topology: any, object: any): any;
  export function mesh(topology: any, object?: any, filter?: (a: any, b: any) => boolean): any;
}
