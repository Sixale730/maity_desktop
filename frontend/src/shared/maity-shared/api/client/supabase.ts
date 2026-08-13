/**
 * Shim de adaptacion: los services copiados de @maity/shared importan supabase
 * desde '../../api/client/supabase'. En el desktop, el cliente vive en
 * @/lib/supabase. Este archivo existe solo para preservar esa ruta de import y
 * mantener el arbol copiado sin drift contra el repo web.
 *
 * Antes esto era un Proxy que forzaba .schema('public') en rpc() y from(),
 * porque el cliente del desktop tenia 'maity' como default. Desde #70 el
 * default YA es 'public', asi que el Proxy quedaba en no-op: indireccion
 * redundante que duplicaba un invariante global y podia divergir de el.
 *
 * Los services que necesitan una tabla de maity siguen usando .schema('maity')
 * explicito, que antes pasaba por el passthrough del Proxy y ahora llega
 * directo al cliente real. Comportamiento identico.
 *
 * NO importar desde @maity/shared aqui — evita ciclos de importacion.
 */

export { supabase } from '@/lib/supabase'
