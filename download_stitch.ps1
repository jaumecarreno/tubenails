$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path ".\frontend_assets" | Out-Null

Write-Host "Downloading Dashboard..."
curl.exe -L -o ".\frontend_assets\dashboard.png" "https://lh3.googleusercontent.com/aida/AOfcidWq6YTql8uNuFeQLjHTFEPf6UgX_xj0cGCDlXUnNmies4DUSCK5y3Yq7jwkmpQpt8lq_dmcL43poqsbF-6sTG898aNZ5Wp-3Unz8dUapB8n-mh_RXQXqtY9oMYSQn1-Ey1EObfcH3MtPOR9ulYy_G_W5-LX26Op5emp3H9NVvltBVYemsLRGf46v8qv7qSqPUg1otyzM_DZFp2ZCZpvRd4WIvQ5vYi2odj_lCK1yGY4lCk5tB3MckqFudCe"
curl.exe -L -o ".\frontend_assets\dashboard.html" "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzVkNmZkOTk3YzFiNTQ0MjdhYzRiODY2ZmZiZDRhMmM4EgsSBxD0_4SZqgUYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjQxOTExMDIwMDExMjA5OTMyNg&filename=&opi=89354086"

Write-Host "Downloading Create Test Form..."
curl.exe -L -o ".\frontend_assets\create_test.png" "https://lh3.googleusercontent.com/aida/AOfcidVIOZ2_OuOliBmPqSTn4TmEByqpF2nXqLN_cqxKy9bVQ1kbMnbB3W7UZTYeyHV9OYDPSvwHyPQU8MGlHex4lj2BKgBTzLFHP8eEwxMOFV1ANPRXO7SJd9bfmGfdTo1eXJjqLT5V2u22YM4o3npU5pBCKYiDvS6a_dizXE9bkz8iANoxOFtQgkeYEVx2QF_1bNSpgYxr7Qt4ru0W19mYixzlYZb3JqtCbsy2__6TMJfcmhb-_zPuhieKOK-0"
curl.exe -L -o ".\frontend_assets\create_test.html" "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzI1MTZiYThiMTIxMzQyYzFhODJjYzE3YTA3MmM1MGJmEgsSBxD0_4SZqgUYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjQxOTExMDIwMDExMjA5OTMyNg&filename=&opi=89354086"

Write-Host "Downloading Results Verdict Screen..."
curl.exe -L -o ".\frontend_assets\results.png" "https://lh3.googleusercontent.com/aida/AOfcidV6MEabxeJ69GuzVUnlEiJw4IcRUMd5gXSkfHJEmG9444CTMFaijSKth-4ftYy3VpDVxSc4lRoV2H0X23zY_LqfDa0cJZHTwLpa3BXabwMjGQ-79lwy4A_pjKD_ICKgKTF3938nNkz5R_gz0SO8L97W5iVv8XUAr3Fn-F8lXPWAZfACqz-4ZOKKTF5jhKEqqVXhP5DNqyHXSr46y5SdK3QZ7HPGWvhL4INjPX21v3sC4MaSexl1Jp-M6XqD"
curl.exe -L -o ".\frontend_assets\results.html" "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzM0NjEyMDI5NjQ4ODQ1MGJiZDA4NDkyMzIxMTIyMDJlEgsSBxD0_4SZqgUYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjQxOTExMDIwMDExMjA5OTMyNg&filename=&opi=89354086"

Write-Host "Downloading Settings Billing Screen..."
curl.exe -L -o ".\frontend_assets\settings.png" "https://lh3.googleusercontent.com/aida/AOfcidV0H1f4WpASOidRk2_rfcTzMFkRz4Xwt3Tm4NqNG-Z2RqyQ-ZpoSa9nitQI7umSXcCw8YNxUSQgaPIcbjHamFXrIy5QHqGy8yMcEetLJ8fbuMuho2hAyOBS8A3F8HDK3a-Uu-zbhXLQHqht79qHJ-TmISVhtG6J2978371uWVLXZxj_hmrURGA6B7Gd8bp4OqjPpKacWx5TjGOfhEKO12wPn_Q15Wiy4CHJYrlh9g31rZHdvvre3faAmf4"
curl.exe -L -o ".\frontend_assets\settings.html" "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzdjZDA1OWM2NTk0YjRmYTZiYmI1MzQ1NzJjZjBhMzM1EgsSBxD0_4SZqgUYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjQxOTExMDIwMDExMjA5OTMyNg&filename=&opi=89354086"

Write-Host "Successfully downloaded UI reference assets!"
