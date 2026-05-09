# Scope
1. You have access to `ssh monitor` on remote, behind candy compose.
1.5. query.tw is available for serving
2. Need Vite frontend with tailwind CSS
3. Use redis to serve the queries with cache
4. Use postgresql for database
5. Use go for backend.
6. zh-TW for frontend
7. PWA to install on mobile. 
8. Favorites are stored locally. Only jobs data are stored on the server. All the configs (favorites filter, seen jobs) are stored in binary to save space, and allow QR Code to transfer the configs (scan and get the binary config, and parse on another device) between devices.

# What to do
- Query "徵才" "找人" on threads.com, and use LLM to parse location, job title, pay, requirement, ...everything needed for job. Please discuss this first.
- Once parsed, put it to Postgresql, along with link to origin post, and the author. Note that if the original post is multi threads, we will need to open it.
- Serve it, with a collapsable sidebar to filter different criteria.
- Stay with Taiwan jobs for now.
- Need to determine a name (脆找工作)
- QR code config transfer
- What else can we do?
