export default {
  server: {
    host: true,
    // shared network namespace: the api really is on localhost from here
    proxy: { '/api': 'http://localhost:3000' },
  },
}
